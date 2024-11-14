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

import { WordCodec } from "../common/codec/WordCodec.sol";
import { FlashLoans } from "./FlashLoans.sol";
import { ProtocolFees } from "./ProtocolFees.sol";

contract PoolManager is ProtocolFees, FlashLoans, IPoolManager {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
  using SafeERC20Upgradeable for IERC20Upgradeable;
  using WordCodec for bytes32;

  /**********
   * Errors *
   **********/

  error ErrorCollateralExceedCapacity();

  error ErrorDebtExceedCapacity();

  error ErrorPoolNotRegistered();

  error ErrorInvalidPool();

  error ErrorCallerNotStakedFxUSD();

  error ErrorRedeemExceedBalance();

  /*************
   * Constants *
   *************/

  /// @dev The precision for token rate.
  uint256 internal constant PRECISION = 1e18;

  /// @dev The precision for token rate.
  int256 internal constant PRECISION_I256 = 1e18;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @inheritdoc IPoolManager
  address public immutable fxUSD;

  /// @inheritdoc IPoolManager
  address public immutable sfxUSD;

  /// @inheritdoc IPoolManager
  address public immutable pegKeeper;

  /***********
   * Structs *
   ***********/

  /// @dev The struct for pool information.
  /// @param collateralData The data for collateral.
  ///   ```text
  ///   * Field                 Bits    Index       Comments
  ///   * collateral capacity   96      0           The maximum allowed amount of collateral tokens.
  ///   * collateral balance    96      96          The amount of collateral tokens deposited.
  ///   * reserved              64      192         Reserved data.
  ///   ```
  /// @param debtData The data for debt.
  ///   ```text
  ///   * Field             Bits    Index       Comments
  ///   * debt capacity     96      0           The maximum allowed amount of debt tokens.
  ///   * debt balance      96      96         The amount of debt tokens borrowed.
  ///   * reserved          64      192         Reserved data.
  ///   ```
  struct PoolStruct {
    bytes32 collateralData;
    bytes32 debtData;
  }

  /// @dev The struct for token rate information.
  /// @param scalar The token scalar to reach 18 decimals.
  /// @param rateProvider The address of token rate provider.
  struct TokenRate {
    uint96 scalar;
    address rateProvider;
  }

  /// @dev Memory variables for liquidate or rebalance.
  /// @param stablePrice The USD price of stable token (with scalar).
  /// @param scalingFactor The scaling factor for collateral token.
  /// @param collateralToken The address of collateral token.
  /// @param rawColls The amount of raw collateral tokens liquidated or rebalanced.
  /// @param rawDebts The amount of raw debt tokens liquidated or rebalanced.
  struct LiquidateOrRebalanceMemoryVar {
    uint256 stablePrice;
    uint256 scalingFactor;
    address collateralToken;
    uint256 rawColls;
    uint256 rawDebts;
  }

  /*********************
   * Storage Variables *
   *********************/

  /// @dev The list of registered pools.
  EnumerableSetUpgradeable.AddressSet private pools;

  /// @notice Mapping to pool address to pool struct.
  mapping(address => PoolStruct) public poolInfo;

  /// @notice Mapping from pool address to rewards splitter.
  mapping(address => address) public rewardSplitter;

  /// @notice Mapping from token address to token rate struct.
  mapping(address => TokenRate) public tokenRates;

  /*************
   * Modifiers *
   *************/

  modifier onlyRegisteredPool(address pool) {
    if (!pools.contains(pool)) revert ErrorPoolNotRegistered();
    _;
  }

  modifier onlyStakedFxUSD() {
    if (_msgSender() != sfxUSD) revert ErrorCallerNotStakedFxUSD();
    _;
  }

  /***************
   * Constructor *
   ***************/

  constructor(address _fxUSD, address _sfxUSD, address _pegKeeper) {
    fxUSD = _fxUSD;
    sfxUSD = _sfxUSD;
    pegKeeper = _pegKeeper;
  }

  function initialize(
    address admin,
    uint256 _expenseRatio,
    uint256 _harvesterRatio,
    uint256 _flashLoanFeeRatio,
    address _platform,
    address _reservePool
  ) external initializer {
    __Context_init();
    __AccessControl_init();
    __ERC165_init();

    _grantRole(DEFAULT_ADMIN_ROLE, admin);

    __ProtocolFees_init(_expenseRatio, _harvesterRatio, _flashLoanFeeRatio, _platform, _reservePool);
    __FlashLoans_init();
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IPoolManager
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

    emit Operate(pool, positionId, newRawColl, newRawDebt, protocolFees);

    return positionId;
  }

  /// @inheritdoc IPoolManager
  function redeem(
    address pool,
    uint256 rawDebts
  ) external onlyRegisteredPool(pool) nonReentrant returns (uint256 rawColls) {
    if (rawDebts > IERC20Upgradeable(fxUSD).balanceOf(_msgSender())) {
      revert ErrorRedeemExceedBalance();
    }

    rawColls = IPool(pool).redeem(rawDebts);

    address collateralToken = IPool(pool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);
    rawColls = _scaleDown(rawColls, scalingFactor);

    _changePoolCollateral(pool, -int256(rawColls));
    _changePoolDebts(pool, -int256(rawDebts));

    uint256 protocolFees = (rawColls * getRedeemFeeRatio()) / FEE_PRECISION;
    _accumulatePoolFee(pool, protocolFees);
    rawColls -= protocolFees;

    IERC20Upgradeable(collateralToken).safeTransfer(_msgSender(), rawColls);
    IFxUSDRegeneracy(fxUSD).burn(_msgSender(), rawDebts);

    emit Redeem(pool, rawColls, rawDebts, protocolFees);
  }

  /// @inheritdoc IPoolManager
  function rebalance(
    address pool,
    address receiver,
    int16 tick,
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
    IPool.RebalanceResult memory result = IPool(pool).rebalance(tick, maxFxUSD + _scaleUp(maxStable, op.stablePrice));
    op.rawColls = result.rawColls + result.bonusRawColls;
    op.rawDebts = result.rawDebts;
    (colls, fxUSDUsed, stableUsed) = _afterRebalanceOrLiquidate(pool, maxFxUSD, op, receiver);

    emit RebalanceTick(pool, tick, colls, fxUSDUsed, stableUsed);
  }

  /// @inheritdoc IPoolManager
  function rebalance(
    address pool,
    address receiver,
    uint32 position,
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
      position,
      maxFxUSD + _scaleUp(maxStable, op.stablePrice)
    );
    op.rawColls = result.rawColls + result.bonusRawColls;
    op.rawDebts = result.rawDebts;
    (colls, fxUSDUsed, stableUsed) = _afterRebalanceOrLiquidate(pool, maxFxUSD, op, receiver);

    emit RebalancePosition(pool, position, colls, fxUSDUsed, stableUsed);
  }

  /// @inheritdoc IPoolManager
  function liquidate(
    address pool,
    address receiver,
    uint32 position,
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
    {
      IPool.LiquidateResult memory result;
      uint256 reservedRawColls = IReservePool(reservePool).getBalance(op.collateralToken);
      reservedRawColls = _scaleUp(reservedRawColls, op.scalingFactor);
      result = IPool(pool).liquidate(position, maxFxUSD + _scaleUp(maxStable, op.stablePrice), reservedRawColls);
      op.rawColls = result.rawColls + result.bonusRawColls;
      op.rawDebts = result.rawDebts;

      // take bonus from reserve pool
      uint256 bonusFromReserve = result.bonusFromReserve;
      if (bonusFromReserve > 0) {
        bonusFromReserve = _scaleDown(result.bonusFromReserve, op.scalingFactor);
        IReservePool(reservePool).requestBonus(IPool(pool).collateralToken(), address(this), bonusFromReserve);

        // increase pool reserve first
        _changePoolCollateral(pool, int256(bonusFromReserve));
      }
    }

    (colls, fxUSDUsed, stableUsed) = _afterRebalanceOrLiquidate(pool, maxFxUSD, op, receiver);

    emit LiquidatePosition(pool, position, colls, fxUSDUsed, stableUsed);
  }

  /// @inheritdoc IPoolManager
  function harvest(address pool) external onlyRegisteredPool(pool) nonReentrant returns (uint256 amountRewards) {
    // compute pending rewards
    address collateralToken = IPool(pool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);
    amountRewards = _scaleDown(IPool(pool).getTotalRawColls(), scalingFactor);
    amountRewards = poolInfo[pool].collateralData.decodeUint(96, 96) - amountRewards;
    _changePoolCollateral(pool, -int256(amountRewards));

    // distribute pending rewards
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

  /// @notice Register a new pool with reward splitter.
  /// @param pool The address of pool.
  /// @param splitter The address of reward splitter.
  function registerPool(
    address pool,
    address splitter,
    uint96 collateralCapacity,
    uint96 debtCapacity
  ) external onlyRole(DEFAULT_ADMIN_ROLE) {
    if (fxUSD != IPool(pool).fxUSD()) revert ErrorInvalidPool();

    if (pools.add(pool)) {
      emit RegisterPool(pool);

      _updateRewardSplitter(pool, splitter);
      _updatePoolCapacity(pool, collateralCapacity, debtCapacity);
    }
  }

  /// @notice Update rate provider for the given token.
  /// @param token The address of the token.
  /// @param provider The address of corresponding rate provider.
  function updateRateProvider(address token, address provider) external onlyRole(DEFAULT_ADMIN_ROLE) {
    uint256 scale = 10 ** (18 - IERC20MetadataUpgradeable(token).decimals());
    tokenRates[token] = TokenRate(uint96(scale), provider);

    emit UpdateTokenRate(token, scale, provider);
  }

  /// @notice Update the address of reward splitter for the given pool.
  /// @param pool The address of the pool.
  /// @param newSplitter The address of reward splitter.
  function updateRewardSplitter(
    address pool,
    address newSplitter
  ) external onlyRole(DEFAULT_ADMIN_ROLE) onlyRegisteredPool(pool) {
    _updateRewardSplitter(pool, newSplitter);
  }

  /// @notice Update the pool capacity.
  /// @param pool The address of fx pool.
  /// @param collateralCapacity The capacity for collateral token.
  /// @param debtCapacity The capacity for debt token.
  function updatePoolCapacity(
    address pool,
    uint96 collateralCapacity,
    uint96 debtCapacity
  ) external onlyRole(DEFAULT_ADMIN_ROLE) onlyRegisteredPool(pool) {
    _updatePoolCapacity(pool, collateralCapacity, debtCapacity);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to update the address of reward splitter for the given pool.
  /// @param pool The address of the pool.
  /// @param newSplitter The address of reward splitter.
  function _updateRewardSplitter(address pool, address newSplitter) internal {
    address oldSplitter = rewardSplitter[pool];
    rewardSplitter[pool] = newSplitter;

    emit UpdateRewardSplitter(pool, oldSplitter, newSplitter);
  }

  /// @dev Internal function to update the pool capacity.
  /// @param pool The address of fx pool.
  /// @param collateralCapacity The capacity for collateral token.
  /// @param debtCapacity The capacity for debt token.
  function _updatePoolCapacity(address pool, uint96 collateralCapacity, uint96 debtCapacity) internal {
    poolInfo[pool].collateralData = poolInfo[pool].collateralData.insertUint(collateralCapacity, 0, 96);
    poolInfo[pool].debtData = poolInfo[pool].debtData.insertUint(debtCapacity, 0, 96);

    emit UpdatePoolCapacity(pool, collateralCapacity, debtCapacity);
  }

  /// @dev Internal function to scaler up for `uint256`.
  function _scaleUp(uint256 value, uint256 scale) internal pure returns (uint256) {
    return (value * scale) / PRECISION;
  }

  /// @dev Internal function to scaler up for `int256`.
  function _scaleUp(int256 value, uint256 scale) internal pure returns (int256) {
    return (value * int256(scale)) / PRECISION_I256;
  }

  /// @dev Internal function to scaler down for `uint256`.
  function _scaleDown(uint256 value, uint256 scale) internal pure returns (uint256) {
    return (value * PRECISION) / scale;
  }

  /// @dev Internal function to scaler down for `int256`.
  function _scaleDown(int256 value, uint256 scale) internal pure returns (int256) {
    return (value * PRECISION_I256) / int256(scale);
  }

  /// @dev Internal function to prepare variables before rebalance or liquidate.
  /// @param pool The address of pool to liquidate or rebalance.
  function _beforeRebalanceOrLiquidate(address pool) internal view returns (LiquidateOrRebalanceMemoryVar memory op) {
    op.stablePrice = IStakedFxUSD(sfxUSD).getStableTokenPriceWithScale();
    op.collateralToken = IPool(pool).collateralToken();
    op.scalingFactor = _getTokenScalingFactor(op.collateralToken);
  }

  /// @dev Internal function to do actions after rebalance or liquidate.
  /// @param pool The address of pool to liquidate or rebalance.
  /// @param maxFxUSD The maximum amount of fxUSD can be used.
  /// @param op The memory helper variable.
  /// @param receiver The address collateral token receiver.
  /// @return colls The actual amount of collateral token rebalanced or liquidated.
  /// @return fxUSDUsed The amount of fxUSD used.
  /// @return stableUsed The amount of stable token (a.k.a USDC) used.
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

  /// @dev Internal function to update collateral balance.
  function _changePoolCollateral(address pool, int256 delta) internal {
    bytes32 data = poolInfo[pool].collateralData;
    uint256 capacity = data.decodeUint(0, 96);
    uint256 balance = uint256(int256(data.decodeUint(96, 96)) + delta);
    if (balance > capacity) revert ErrorCollateralExceedCapacity();
    poolInfo[pool].collateralData = data.insertUint(balance, 96, 96);
  }

  /// @dev Internal function to update debt balance.
  function _changePoolDebts(address pool, int256 delta) internal {
    bytes32 data = poolInfo[pool].debtData;
    uint256 capacity = data.decodeUint(0, 96);
    uint256 balance = uint256(int256(data.decodeUint(96, 96)) + delta);
    if (balance > capacity) revert ErrorDebtExceedCapacity();
    poolInfo[pool].debtData = data.insertUint(balance, 96, 96);
  }

  /// @dev Internal function to get token scaling factor.
  function _getTokenScalingFactor(address token) internal view returns (uint256 value) {
    TokenRate memory rate = tokenRates[token];
    value = rate.scalar;
    unchecked {
      if (rate.rateProvider != address(0)) {
        value *= IRateProvider(rate.rateProvider).getRate();
      } else {
        value *= PRECISION;
      }
    }
  }
}
