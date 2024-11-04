// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable-v4/access/AccessControlUpgradeable.sol";
import { EnumerableSetUpgradeable } from "@openzeppelin/contracts-upgradeable-v4/utils/structs/EnumerableSetUpgradeable.sol";
import { IERC20MetadataUpgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/IERC20Upgradeable.sol";

import { IFxUSDRegeneracy } from "../interfaces/IFxUSDRegeneracy.sol";
import { IPool } from "../interfaces/IPool.sol";
import { IPoolManager } from "../interfaces/IPoolManager.sol";
import { IRateProvider } from "../interfaces/IRateProvider.sol";
import { IReservePool } from "../interfaces/IReservePool.sol";
import { IRewardSplitter } from "../interfaces/IRewardSplitter.sol";
import { IStakedFxUSD } from "../interfaces/IStakedFxUSD.sol";

import { FlashLoans } from "./FlashLoans.sol";
import { ProtocolFees } from "./ProtocolFees.sol";

contract PoolManager is ProtocolFees, FlashLoans, IPoolManager {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
  using SafeERC20Upgradeable for IERC20Upgradeable;

  uint256 internal constant PRECISION = 1e18;

  int256 internal constant PRECISION_I256 = 1e18;

  address public immutable fxUSD;

  address public immutable sfxUSD;

  address public immutable pegKeeper;

  struct PoolStruct {
    uint256 collateralCapacity;
    uint256 debtCapacity;
    uint256 collateralBalance;
    uint256 debtBalance;
    uint256 accumulatedProtocolFee;
  }

  struct TokenRate {
    uint96 scalar;
    address rateProvider;
  }

  struct LiquidateOrRebalanceMemoryVar {
    uint256 stablePrice;
    uint256 scalingFactor;
    address collateralToken;
    uint256 rawColls;
    uint256 rawDebts;
  }

  EnumerableSetUpgradeable.AddressSet private pools;

  mapping(address => PoolStruct) public poolInfo;

  /// @dev Mapping from pool address to rewards splitter.
  mapping(address => address) public rewardSplitter;

  mapping(address => TokenRate) public rateProviders;

  modifier onlyRegisteredPool(address pool) {
    if (!pools.contains(pool)) revert();
    _;
  }

  modifier onlyStakedFxUSD() {
    if (_msgSender() != sfxUSD) revert();
    _;
  }

  constructor(address _fxUSD, address _sfxUSD, address _pegKeeper) {
    fxUSD = _fxUSD;
    sfxUSD = _sfxUSD;
    pegKeeper = _pegKeeper;
  }

  function operate(
    address pool,
    uint256 positionId,
    int256 newRawColl,
    int256 newRawDebt
  ) external onlyRegisteredPool(pool) nonReentrant returns (uint256) {
    address collateralToken = IPool(pool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);

    newRawColl = _scaleUp(newRawColl, scalingFactor);

    uint256 protocolFees;
    (positionId, newRawColl, newRawDebt, protocolFees) = IPool(pool).operate(
      positionId,
      newRawColl,
      newRawDebt,
      _msgSender()
    );

    newRawColl = _scaleDown(newRawColl, scalingFactor);
    protocolFees = _scaleDown(protocolFees, scalingFactor);
    _accumulatePoolFee(pool, protocolFees);
    _changePoolCollateral(pool, newRawColl - int256(protocolFees));
    _changePoolDebts(pool, newRawDebt);

    if (newRawColl > 0) {
      IERC20Upgradeable(collateralToken).safeTransferFrom(
        _msgSender(),
        address(this),
        uint256(newRawColl) + protocolFees
      );
    } else if (newRawColl < 0) {
      IERC20Upgradeable(collateralToken).safeTransfer(_msgSender(), uint256(-newRawColl));
    }

    if (newRawDebt > 0) {
      IFxUSDRegeneracy(fxUSD).mint(_msgSender(), uint256(newRawDebt));
    } else if (newRawDebt < 0) {
      IFxUSDRegeneracy(fxUSD).burn(_msgSender(), uint256(-newRawDebt));
    }

    return positionId;
  }

  function rebalance(
    address pool,
    address receiver,
    int16 tickId,
    uint256 maxFxUSD,
    uint256 maxStable
  )
    external
    onlyRegisteredPool(pool)
    nonReentrant
    onlyStakedFxUSD
    returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed)
  {
    LiquidateOrRebalanceMemoryVar memory op = _beforeRebalanceOrLiquidate(pool);
    IPool.RebalanceResult memory result = IPool(pool).rebalance(tickId, maxFxUSD + _scaleUp(maxStable, op.stablePrice));
    op.rawColls = result.rawColls;
    op.rawDebts = result.rawDebts;
    (colls, fxUSDUsed, stableUsed) = _afterRebalanceOrLiquidate(pool, maxFxUSD, op, receiver);
  }

  function rebalance(
    address pool,
    address receiver,
    uint32 positionId,
    uint256 maxFxUSD,
    uint256 maxStable
  )
    external
    onlyRegisteredPool(pool)
    nonReentrant
    onlyStakedFxUSD
    returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed)
  {
    LiquidateOrRebalanceMemoryVar memory op = _beforeRebalanceOrLiquidate(pool);
    IPool.RebalanceResult memory result = IPool(pool).rebalance(
      positionId,
      maxFxUSD + _scaleUp(maxStable, op.stablePrice)
    );
    op.rawColls = result.rawColls;
    op.rawDebts = result.rawDebts;
    (colls, fxUSDUsed, stableUsed) = _afterRebalanceOrLiquidate(pool, maxFxUSD, op, receiver);
  }

  function liquidate(
    address pool,
    address receiver,
    uint32 positionId,
    uint256 maxFxUSD,
    uint256 maxStable
  )
    external
    onlyRegisteredPool(pool)
    nonReentrant
    onlyStakedFxUSD
    returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed)
  {
    LiquidateOrRebalanceMemoryVar memory op = _beforeRebalanceOrLiquidate(pool);
    uint256 bonusFromReserve;
    {
      IPool.LiquidateResult memory result;
      uint256 reservedRawDebts = IReservePool(reservePool).getBalance(op.collateralToken);
      reservedRawDebts = _scaleUp(reservedRawDebts, op.scalingFactor);
      result = IPool(pool).liquidate(positionId, maxFxUSD + _scaleUp(maxStable, op.stablePrice), reservedRawDebts);
      op.rawColls = result.rawColls;
      op.rawDebts = result.rawDebts;
      bonusFromReserve = result.bonusFromReserve;
    }
    (colls, fxUSDUsed, stableUsed) = _afterRebalanceOrLiquidate(pool, maxFxUSD, op, receiver);

    // take bonus from reserve pool
    if (bonusFromReserve > 0) {
      IReservePool(reservePool).requestBonus(
        IPool(pool).collateralToken(),
        _msgSender(),
        _scaleDown(bonusFromReserve, op.scalingFactor)
      );
    }
  }

  function harvest(address pool) external onlyRegisteredPool(pool) nonReentrant returns (uint256 amountRewards) {
    address collateralToken = IPool(pool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);
    uint256 actualCollateral = _scaleDown(IPool(pool).getTotalRawColls(), scalingFactor);
    amountRewards = poolInfo[pool].collateralBalance - actualCollateral;

    _changePoolCollateral(pool, -int256(amountRewards));

    uint256 performanceFee = (getExpenseRatio() * amountRewards) / FEE_PRECISION;
    uint256 harvestBounty = (getHarvesterRatio() * amountRewards) / FEE_PRECISION;
    uint256 pendingRewards = amountRewards - harvestBounty - performanceFee;

    _accumulatePoolFee(pool, performanceFee);
    if (harvestBounty > 0) {
      IERC20Upgradeable(collateralToken).safeTransfer(_msgSender(), harvestBounty);
    }
    if (pendingRewards > 0) {
      address splitter = rewardSplitter[pool];

      IERC20Upgradeable(collateralToken).safeTransfer(splitter, pendingRewards);
      IRewardSplitter(splitter).split(collateralToken);
    }

    emit Harvest(_msgSender(), pool, amountRewards, performanceFee, harvestBounty);
  }

  /************************
   * Restricted Functions *
   ************************/

  function registerPool(address pool, address splitter) external onlyRole(DEFAULT_ADMIN_ROLE) {
    if (fxUSD != IPool(pool).fxUSD()) revert();

    pools.add(pool);
    rewardSplitter[pool] = splitter;

    emit UpdateRewardSplitter(pool, address(0), splitter);
  }

  function updateRateProvider(address token, address provider) external onlyRole(DEFAULT_ADMIN_ROLE) {
    uint256 scale = 10 ** (18 - IERC20MetadataUpgradeable(token).decimals());
    rateProviders[token] = TokenRate(uint96(scale), provider);
  }

  /// @notice Update the address of reward splitter for the given pool.
  /// @param pool The address of the pool.
  /// @param newSplitter The address of reward splitter.
  function updateRewardSplitter(
    address pool,
    address newSplitter
  ) external onlyRole(DEFAULT_ADMIN_ROLE) onlyRegisteredPool(pool) {
    address oldSplitter = rewardSplitter[pool];
    rewardSplitter[pool] = newSplitter;

    emit UpdateRewardSplitter(pool, oldSplitter, newSplitter);
  }

  function _scaleUp(uint256 value, uint256 scale) internal pure returns (uint256) {
    return (value * scale) / PRECISION;
  }

  function _scaleUp(int256 value, uint256 scale) internal pure returns (int256) {
    return (value * int256(scale)) / PRECISION_I256;
  }

  function _scaleDown(uint256 value, uint256 scale) internal pure returns (uint256) {
    return (value * PRECISION) / scale;
  }

  function _scaleDown(int256 value, uint256 scale) internal pure returns (int256) {
    return (value * PRECISION_I256) / int256(scale);
  }

  function _beforeRebalanceOrLiquidate(address pool) internal view returns (LiquidateOrRebalanceMemoryVar memory op) {
    op.stablePrice = IStakedFxUSD(sfxUSD).getStableTokenPriceWithScale();
    op.collateralToken = IPool(pool).collateralToken();
    op.scalingFactor = _getTokenScalingFactor(op.collateralToken);
  }

  function _afterRebalanceOrLiquidate(
    address pool,
    uint256 maxFxUSD,
    LiquidateOrRebalanceMemoryVar memory op,
    address receiver
  ) internal returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed) {
    colls = _scaleDown(op.rawColls, op.scalingFactor);
    _changePoolCollateral(pool, -int256(colls));
    _changePoolDebts(pool, -int256(op.rawDebts));

    // burn fxUSD or transfer USDC
    fxUSDUsed = op.rawDebts;
    if (fxUSDUsed > maxFxUSD) {
      stableUsed = _scaleDown(fxUSDUsed - maxFxUSD, op.stablePrice);
      fxUSDUsed = maxFxUSD;
    }
    if (fxUSDUsed > 0) {
      IFxUSDRegeneracy(fxUSD).burn(_msgSender(), fxUSDUsed);
    }
    if (stableUsed > 0) {
      IERC20Upgradeable(IStakedFxUSD(sfxUSD).stableToken()).safeTransferFrom(_msgSender(), fxUSD, stableUsed);
      IFxUSDRegeneracy(fxUSD).onRebalanceWithStable(stableUsed, op.rawDebts - maxFxUSD);
    }

    // transfer collateral
    IERC20Upgradeable(op.collateralToken).safeTransfer(receiver, colls);
  }

  function _changePoolCollateral(address pool, int256 delta) internal {
    poolInfo[pool].collateralBalance = uint256(int256(poolInfo[pool].collateralBalance) + delta);

    if (poolInfo[pool].collateralBalance > poolInfo[pool].collateralCapacity) revert();
  }

  function _changePoolDebts(address pool, int256 delta) internal {
    poolInfo[pool].debtBalance = uint256(int256(poolInfo[pool].debtBalance) + delta);

    if (poolInfo[pool].debtBalance > poolInfo[pool].debtCapacity) revert();
  }

  function _getTokenScalingFactor(address token) internal view returns (uint256 value) {
    TokenRate memory rate = rateProviders[token];
    value = rate.scalar;
    if (rate.rateProvider == address(0)) {
      value *= IRateProvider(rate.rateProvider).getRate();
    }
  }
}
