// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { IFxUSDRegeneracy } from "../interfaces/IFxUSDRegeneracy.sol";
import { IPool } from "../interfaces/IPool.sol";
import { IPoolManager } from "../interfaces/IPoolManager.sol";
import { IReservePool } from "../interfaces/IReservePool.sol";
import { IRewardSplitter } from "../interfaces/IRewardSplitter.sol";
import { IFxUSDBasePool } from "../interfaces/IFxUSDBasePool.sol";
import { IRateProvider } from "../rate-provider/interfaces/IRateProvider.sol";

import { WordCodec } from "../common/codec/WordCodec.sol";
import { FlashLoans } from "./FlashLoans.sol";
import { ProtocolFees } from "./ProtocolFees.sol";

contract PoolManager is ProtocolFees, FlashLoans, IPoolManager {
  using EnumerableSet for EnumerableSet.AddressSet;
  using SafeERC20 for IERC20;
  using WordCodec for bytes32;

  /**********
   * Errors *
   **********/

  error ErrorCollateralExceedCapacity();

  error ErrorDebtExceedCapacity();

  error ErrorPoolNotRegistered();

  error ErrorInvalidPool();

  error ErrorCallerNotFxUSDSave();

  error ErrorRedeemExceedBalance();

  error ErrorInsufficientRedeemedCollateral();

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
  address public immutable fxBASE;

  /// @inheritdoc IPoolManager
  address public immutable pegKeeper;

  /***********
   * Structs *
   ***********/

  /// @dev The struct for pool information.
  /// @param collateralData The data for collateral.
  ///   ```text
  ///   * Field                     Bits    Index       Comments
  ///   * collateral capacity       85      0           The maximum allowed amount of collateral tokens.
  ///   * collateral balance        85      85          The amount of collateral tokens deposited.
  ///   * raw collateral balance    86      170         The amount of raw collateral tokens (without token rate) managed in pool.
  ///   ```
  /// @param debtData The data for debt.
  ///   ```text
  ///   * Field             Bits    Index       Comments
  ///   * debt capacity     96      0           The maximum allowed amount of debt tokens.
  ///   * debt balance      96      96          The amount of debt tokens borrowed.
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
  EnumerableSet.AddressSet private pools;

  /// @notice Mapping to pool address to pool struct.
  mapping(address => PoolStruct) private poolInfo;

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

  modifier onlyFxUSDSave() {
    if (_msgSender() != fxBASE) revert ErrorCallerNotFxUSDSave();
    _;
  }

  /***************
   * Constructor *
   ***************/

  constructor(address _fxUSD, address _fxBASE, address _pegKeeper) {
    fxUSD = _fxUSD;
    fxBASE = _fxBASE;
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

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Return the pool information.
  /// @param pool The address of pool to query.
  /// @return collateralCapacity The maximum allowed amount of collateral tokens.
  /// @return collateralBalance The amount of collateral tokens deposited.
  /// @return debtCapacity The maximum allowed amount of debt tokens.
  /// @return debtBalance The amount of debt tokens borrowed.
  function getPoolInfo(
    address pool
  )
    external
    view
    returns (uint256 collateralCapacity, uint256 collateralBalance, uint256 debtCapacity, uint256 debtBalance)
  {
    bytes32 data = poolInfo[pool].collateralData;
    collateralCapacity = data.decodeUint(0, 85);
    collateralBalance = data.decodeUint(85, 85);
    data = poolInfo[pool].debtData;
    debtCapacity = data.decodeUint(0, 96);
    debtBalance = data.decodeUint(96, 96);
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IPoolManager
  function operate(
    address pool,
    uint256 positionId,
    int256 newColl,
    int256 newDebt
  ) external onlyRegisteredPool(pool) nonReentrant returns (uint256) {
    address collateralToken = IPool(pool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);

    int256 newRawColl = newColl;
    if (newRawColl != type(int256).min) {
      newRawColl = _scaleUp(newRawColl, scalingFactor);
    }

    uint256 rawProtocolFees;
    // the `newRawColl` is the result without `protocolFees`
    (positionId, newRawColl, newDebt, rawProtocolFees) = IPool(pool).operate(
      positionId,
      newRawColl,
      newDebt,
      _msgSender()
    );

    newColl = _scaleDown(newRawColl, scalingFactor);
    uint256 protocolFees = _scaleDown(rawProtocolFees, scalingFactor);
    _accumulatePoolFee(pool, protocolFees);
    _changePoolDebts(pool, newDebt);
    if (newRawColl > 0) {
      _changePoolCollateral(pool, newColl, newRawColl);
      IERC20(collateralToken).safeTransferFrom(_msgSender(), address(this), uint256(newColl) + protocolFees);
    } else if (newRawColl < 0) {
      _changePoolCollateral(pool, newColl - int256(protocolFees), newRawColl - int256(rawProtocolFees));
      IERC20(collateralToken).safeTransfer(_msgSender(), uint256(-newColl));
    }

    if (newDebt > 0) {
      IFxUSDRegeneracy(fxUSD).mint(_msgSender(), uint256(newDebt));
    } else if (newDebt < 0) {
      IFxUSDRegeneracy(fxUSD).burn(_msgSender(), uint256(-newDebt));
    }

    emit Operate(pool, positionId, newColl, newDebt, protocolFees);

    return positionId;
  }

  /// @inheritdoc IPoolManager
  function redeem(address pool, uint256 debts, uint256 minColls) external onlyRegisteredPool(pool) nonReentrant returns (uint256 colls) {
    if (debts > IERC20(fxUSD).balanceOf(_msgSender())) {
      revert ErrorRedeemExceedBalance();
    }

    uint256 rawColls = IPool(pool).redeem(debts);

    address collateralToken = IPool(pool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);
    colls = _scaleDown(rawColls, scalingFactor);

    _changePoolCollateral(pool, -int256(colls), -int256(rawColls));
    _changePoolDebts(pool, -int256(debts));

    uint256 protocolFees = (colls * getRedeemFeeRatio()) / FEE_PRECISION;
    _accumulatePoolFee(pool, protocolFees);
    colls -= protocolFees;
    if (colls < minColls) revert ErrorInsufficientRedeemedCollateral();

    IERC20(collateralToken).safeTransfer(_msgSender(), colls);
    IFxUSDRegeneracy(fxUSD).burn(_msgSender(), debts);

    emit Redeem(pool, colls, debts, protocolFees);
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
    onlyFxUSDSave
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
    onlyFxUSDSave
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
    onlyFxUSDSave
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
        _changePoolCollateral(pool, int256(bonusFromReserve), int256(result.bonusFromReserve));
      }
    }

    (colls, fxUSDUsed, stableUsed) = _afterRebalanceOrLiquidate(pool, maxFxUSD, op, receiver);

    emit LiquidatePosition(pool, position, colls, fxUSDUsed, stableUsed);
  }

  /// @inheritdoc IPoolManager
  function harvest(
    address pool
  ) external onlyRegisteredPool(pool) nonReentrant returns (uint256 amountRewards, uint256 amountFunding) {
    address collateralToken = IPool(pool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);

    uint256 collateralRecorded;
    uint256 rawCollateralRecorded;
    {
      bytes32 data = poolInfo[pool].collateralData;
      collateralRecorded = data.decodeUint(85, 85);
      rawCollateralRecorded = data.decodeUint(170, 86);
    }
    uint256 performanceFee;
    uint256 harvestBounty;
    uint256 pendingRewards;
    // compute funding
    uint256 rawCollateral = IPool(pool).getTotalRawCollaterals();
    if (rawCollateralRecorded > rawCollateral) {
      unchecked {
        amountFunding = _scaleDown(rawCollateralRecorded - rawCollateral, scalingFactor);
        _changePoolCollateral(pool, -int256(amountFunding), -int256(rawCollateralRecorded - rawCollateral));

        performanceFee = (getFundingExpenseRatio() * amountFunding) / FEE_PRECISION;
        harvestBounty = (getHarvesterRatio() * amountFunding) / FEE_PRECISION;
        pendingRewards = amountFunding - harvestBounty - performanceFee;
      }
    }
    // compute rewards
    rawCollateral = _scaleUp(collateralRecorded, scalingFactor);
    if (rawCollateral > rawCollateralRecorded) {
      unchecked {
        amountRewards = _scaleDown(rawCollateral - rawCollateralRecorded, scalingFactor);
        _changePoolCollateral(pool, -int256(amountRewards), -int256(rawCollateral - rawCollateralRecorded));

        uint256 performanceFeeRewards = (getRewardsExpenseRatio() * amountRewards) / FEE_PRECISION;
        uint256 harvestBountyRewards = (getHarvesterRatio() * amountRewards) / FEE_PRECISION;
        pendingRewards += amountRewards - harvestBountyRewards - performanceFeeRewards;
        performanceFee += performanceFeeRewards;
        harvestBounty += harvestBountyRewards;
      }
    }

    // transfer platform fee
    _accumulatePoolFee(pool, performanceFee);
    _takeAccumulatedPoolFee(pool);
    // transfer harvest bounty
    if (harvestBounty > 0) {
      IERC20(collateralToken).safeTransfer(_msgSender(), harvestBounty);
    }
    // transfer rewards for fxBASE
    if (pendingRewards > 0) {
      address splitter = rewardSplitter[pool];
      IERC20(collateralToken).safeTransfer(splitter, pendingRewards);
      IRewardSplitter(splitter).split(collateralToken);
    }

    emit Harvest(_msgSender(), pool, amountRewards, amountFunding, performanceFee, harvestBounty);
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
    uint256 scale = 10 ** (18 - IERC20Metadata(token).decimals());
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

  /// @dev Internal function to scaler down for `uint256`, rounding down.
  function _scaleDown(uint256 value, uint256 scale) internal pure returns (uint256) {
    return (value * PRECISION) / scale;
  }

  /// @dev Internal function to scaler down for `uint256`, rounding up.
  function _scaleDownRoundingUp(uint256 value, uint256 scale) internal pure returns (uint256) {
    return (value * PRECISION + scale - 1) / scale;
  }

  /// @dev Internal function to scaler down for `int256`.
  function _scaleDown(int256 value, uint256 scale) internal pure returns (int256) {
    return (value * PRECISION_I256) / int256(scale);
  }

  /// @dev Internal function to prepare variables before rebalance or liquidate.
  /// @param pool The address of pool to liquidate or rebalance.
  function _beforeRebalanceOrLiquidate(address pool) internal view returns (LiquidateOrRebalanceMemoryVar memory op) {
    op.stablePrice = IFxUSDBasePool(fxBASE).getStableTokenPriceWithScale();
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
    _changePoolCollateral(pool, -int256(colls), -int256(op.rawColls));
    _changePoolDebts(pool, -int256(op.rawDebts));

    // burn fxUSD or transfer USDC
    fxUSDUsed = op.rawDebts;
    if (fxUSDUsed > maxFxUSD) {
      // rounding up here
      stableUsed = _scaleDownRoundingUp(fxUSDUsed - maxFxUSD, op.stablePrice);
      fxUSDUsed = maxFxUSD;
    }
    if (fxUSDUsed > 0) {
      IFxUSDRegeneracy(fxUSD).burn(_msgSender(), fxUSDUsed);
    }
    if (stableUsed > 0) {
      IERC20(IFxUSDBasePool(fxBASE).stableToken()).safeTransferFrom(_msgSender(), fxUSD, stableUsed);
      IFxUSDRegeneracy(fxUSD).onRebalanceWithStable(stableUsed, op.rawDebts - maxFxUSD);
    }

    // transfer collateral
    IERC20(op.collateralToken).safeTransfer(receiver, colls);
  }

  /// @dev Internal function to update collateral balance.
  function _changePoolCollateral(address pool, int256 delta, int256 rawDelta) internal {
    bytes32 data = poolInfo[pool].collateralData;
    uint256 capacity = data.decodeUint(0, 85);
    uint256 balance = uint256(int256(data.decodeUint(85, 85)) + delta);
    if (balance > capacity) revert ErrorCollateralExceedCapacity();
    data = data.insertUint(balance, 85, 85);
    balance = uint256(int256(data.decodeUint(170, 86)) + rawDelta);
    poolInfo[pool].collateralData = data.insertUint(balance, 170, 86);
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
