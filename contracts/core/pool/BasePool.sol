// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IPegKeeper } from "../../interfaces/IPegKeeper.sol";
import { IPool } from "../../interfaces/IPool.sol";
import { IPoolManager } from "../../interfaces/IPoolManager.sol";
import { IPriceOracle } from "../../price-oracle/interfaces/IPriceOracle.sol";

import { WordCodec } from "../../common/codec/WordCodec.sol";
import { TickBitmap } from "../../libraries/TickBitmap.sol";
import { PositionLogic } from "./PositionLogic.sol";
import { TickLogic } from "./TickLogic.sol";

abstract contract BasePool is TickLogic, PositionLogic {
  using TickBitmap for mapping(int8 => uint256);
  using WordCodec for bytes32;

  /***********
   * Structs *
   ***********/

  struct OperationMemoryVar {
    int256 tick;
    uint32 node;
    uint256 positionColl;
    uint256 positionDebt;
    int256 newColl;
    int256 newDebt;
    uint256 collIndex;
    uint256 debtIndex;
    uint256 globalColl;
    uint256 globalDebt;
  }

  /*************
   * Modifiers *
   *************/

  modifier onlyPoolManager() {
    if (_msgSender() != poolManager) {
      revert ErrorCallerNotPoolManager();
    }
    _;
  }

  /***************
   * Constructor *
   ***************/

  constructor(address _poolManager) {
    poolManager = _poolManager;
    fxUSD = IPoolManager(_poolManager).fxUSD();
    pegKeeper = IPoolManager(_poolManager).pegKeeper();
  }

  function __BasePool_init() internal onlyInitializing {
    _updateDebtIndex(E128);
    _updateCollateralIndex(E128);
    _updateDebtRatioRange(142857142857142857, 500000000000000000); // 1/7 ~ 1/2
    _updateMaxRedeemRatioPerTick(200000000); // 20%
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IPool
  function operate(
    uint256 positionId,
    int256 newRawColl,
    int256 newRawDebt,
    address owner
  ) external onlyPoolManager returns (uint256, int256, int256, uint256) {
    if (newRawColl == 0 && newRawDebt == 0) revert ErrorNoSupplyAndNoBorrow();
    if (newRawColl != 0 && (newRawColl > -MIN_COLLATERAL && newRawColl < MIN_COLLATERAL)) {
      revert ErrorCollateralTooSmall();
    }
    if (newRawDebt != 0 && (newRawDebt > -MIN_DEBT && newRawDebt < MIN_DEBT)) {
      revert ErrorDebtTooSmall();
    }
    if (newRawDebt > 0 && (_isBorrowPaused() || !IPegKeeper(pegKeeper).isBorrowAllowed())) {
      revert ErrorBorrowPaused();
    }

    OperationMemoryVar memory op;
    (op.globalDebt, op.globalColl) = _getDebtAndCollateralShares();
    if (positionId == 0) {
      positionId = _mintPosition(owner);
    } else {
      // checking owner only in case of withdraw or borrow
      if ((newRawColl < 0 || newRawDebt > 0) && ownerOf(positionId) != owner) {
        revert ErrorNotPositionOwner();
      }
      PositionInfo memory position = _getAndUpdatePosition(positionId);
      // temporarily remove position from tick tree for simplicity
      _removePositionFromTick(position);
      op.tick = position.tick;
      op.node = position.nodeId;
      op.positionDebt = position.debts;
      op.positionColl = position.colls;
    }

    (op.collIndex, op.debtIndex) = _updateCollAndDebtIndex();
    uint256 protocolFees;
    // supply or withdraw
    if (newRawColl > 0) {
      protocolFees = _deductProtocolFees(newRawColl);
      op.newColl = int256(_convertToCollShares(uint256(newRawColl), op.collIndex));
      op.positionColl += uint256(op.newColl);
      op.globalColl += uint256(op.newColl);
    } else if (newRawColl < 0) {
      if (newRawColl == type(int256).max) {
        // this is max withdraw
        newRawColl = -int256(_convertToRawColl(op.positionColl, op.collIndex));
        op.newColl = -int256(op.positionColl);
      } else {
        // this is partial withdraw, rounding up removing extra wei from collateral
        op.newColl = -int256(_convertToCollShares(uint256(-newRawColl), op.collIndex)) + 1;
        if (uint256(-op.newColl) > op.positionColl) revert ErrorWithdrawExceedSupply();
      }
      unchecked {
        op.positionColl -= uint256(-op.newColl);
        op.globalColl -= uint256(-op.newColl);
      }
      protocolFees = _deductProtocolFees(newRawColl);
    }

    // borrow or repay
    if (newRawDebt > 0) {
      // rounding up adding extra wei in debt
      op.newDebt = int256(_convertToDebtShares(uint256(newRawDebt), op.debtIndex) + 1);
      op.positionDebt += uint256(op.newDebt);
      op.globalDebt += uint256(op.newDebt);
    } else if (newRawDebt < 0) {
      if (newRawDebt == type(int256).min) {
        // this is max repay, rounding up amount that will be transferred in to pay back full debt:
        // subtracting -1 of negative debtAmount newDebt_ for safe rounding (increasing payback)
        newRawDebt = -int256(_convertToRawDebt(op.positionDebt, op.debtIndex)) - 1;
        op.newDebt = -int256(op.positionDebt);
      } else {
        // this is partial repay, safe rounding up negative amount to rounding reduce payback
        op.newDebt = -int256(_convertToDebtShares(uint256(-newRawDebt), op.debtIndex)) + 1;
      }
      op.positionDebt -= uint256(-op.newDebt);
      op.globalDebt -= uint256(-op.newDebt);
    }

    // debt ratio check
    {
      // price precision and ratio precision are both 1e18
      (, uint256 price, ) = IPriceOracle(priceOracle).getPrice();

      // check position debt ratio is between `minDebtRatio` and `maxDebtRatio`.
      uint256 rawColls = _convertToRawColl(op.positionColl, op.collIndex);
      uint256 rawDebts = _convertToRawDebt(op.positionDebt, op.debtIndex);
      (uint256 minDebtRatio, uint256 maxDebtRatio) = _getDebtRatioRange();
      if (rawDebts * PRECISION * PRECISION > maxDebtRatio * rawColls * price) revert ErrorDebtRatioTooLarge();
      if (rawDebts * PRECISION * PRECISION < minDebtRatio * rawColls * price) revert ErrorDebtRatioTooSmall();

      // if global debt ratio >= 1, only allow supply and repay
      rawColls = _convertToRawColl(op.globalColl, op.collIndex);
      rawDebts = _convertToRawDebt(op.globalDebt, op.debtIndex);
      if (rawDebts * PRECISION >= rawColls * price) {
        if (newRawColl < 0 || newRawDebt > 0) revert ErrorPoolUnderCollateral();
      }
    }

    // update position state to storage
    (op.tick, op.node) = _addPositionToTick(op.positionColl, op.positionDebt, true);
    positionData[positionId] = PositionInfo(
      int16(op.tick),
      uint32(op.node),
      uint104(op.positionColl),
      uint104(op.positionDebt)
    );

    // update global state to storage
    _updateDebtAndCollateralShares(op.globalDebt, op.globalColl);

    if (newRawColl > 0) {
      newRawColl -= int256(protocolFees);
    } else if (newRawColl < 0) {
      newRawColl += int256(protocolFees);
    }

    return (positionId, newRawColl, newRawDebt, protocolFees);
  }

  /// @inheritdoc IPool
  function redeem(uint256 rawDebts) external onlyPoolManager returns (uint256 rawColls) {
    if (_isRedeemPaused()) revert ErrorRedeemPaused();

    (uint256 cachedCollIndex, uint256 cachedDebtIndex) = _updateCollAndDebtIndex();
    (, , uint256 price) = IPriceOracle(priceOracle).getPrice(); // use max price
    uint256 debtShare = _convertToDebtShares(rawDebts, cachedDebtIndex);

    int16 tick = _getTopTick();
    bool hasDebt = true;

    (uint256 cachedTotalDebts, uint256 cachedTotalColls) = _getDebtAndCollateralShares();
    while (debtShare > 0) {
      if (!hasDebt) {
        (tick, hasDebt) = tickBitmap.nextDebtPositionWithinOneWord(tick - 1);
      } else {
        uint256 node = tickData[tick];
        bytes32 value = tickTreeData[node].value;
        uint256 tickDebtShare = value.decodeUint(128, 128);
        // skip bad debt
        {
          uint256 tickCollShare = value.decodeUint(0, 128);
          if (
            _convertToRawDebt(tickDebtShare, cachedDebtIndex) * PRECISION >
            _convertToRawColl(tickCollShare, cachedCollIndex) * price
          ) {
            tick = tick - 1;
            continue;
          }
        }

        // redeem at most `maxRedeemRatioPerTick`
        uint256 debtShareToRedeem = (tickDebtShare * _getMaxRedeemRatioPerTick()) / FEE_PRECISION;
        if (debtShareToRedeem > debtShare) debtShareToRedeem = debtShare;
        uint256 rawCollRedeemed = (_convertToRawDebt(debtShareToRedeem, cachedDebtIndex) * PRECISION) / price;
        uint256 collShareRedeemed = _convertToCollShares(rawCollRedeemed, cachedCollIndex);
        _liquidateTick(tick, collShareRedeemed, debtShareToRedeem);
        debtShare -= debtShareToRedeem;
        rawColls += rawCollRedeemed;

        cachedTotalColls -= collShareRedeemed;
        cachedTotalDebts -= debtShareToRedeem;

        (tick, hasDebt) = tickBitmap.nextDebtPositionWithinOneWord(tick - 1);
      }
      if (tick == type(int16).min) break;
    }
    _updateDebtAndCollateralShares(cachedTotalDebts, cachedTotalColls);
  }

  /// @inheritdoc IPool
  function rebalance(int16 tick, uint256 maxRawDebts) external onlyPoolManager returns (RebalanceResult memory result) {
    (uint256 cachedCollIndex, uint256 cachedDebtIndex) = _updateCollAndDebtIndex();
    (, uint256 price, ) = IPriceOracle(priceOracle).getPrice(); // use min price
    uint256 node = tickData[tick];
    bytes32 value = tickTreeData[node].value;
    uint256 tickRawColl = _convertToRawColl(value.decodeUint(0, 128), cachedCollIndex);
    uint256 tickRawDebt = _convertToRawDebt(value.decodeUint(128, 128), cachedDebtIndex);
    (uint256 rebalanceDebtRatio, uint256 rebalanceBonusRatio) = _getRebalanceRatios();
    // rebalance only debt ratio >= `rebalanceDebtRatio`
    if (tickRawDebt * PRECISION * PRECISION < rebalanceDebtRatio * tickRawColl * price) {
      revert ErrorRebalanceDebtRatioNotReached();
    }

    // compute debts to rebalance to make debt ratio to `rebalanceDebtRatio`
    result.rawDebts = _getRawDebtToRebalance(tickRawColl, tickRawDebt, price, rebalanceDebtRatio, rebalanceBonusRatio);
    if (maxRawDebts < result.rawDebts) result.rawDebts = maxRawDebts;

    uint256 debtShareToRebalance = _convertToDebtShares(result.rawDebts, cachedDebtIndex);
    result.rawColls = (result.rawDebts * PRECISION) / price;
    result.bonusRawColls = (result.rawColls * rebalanceBonusRatio) / FEE_PRECISION;
    if (result.bonusRawColls > tickRawColl - result.rawColls) {
      result.bonusRawColls = tickRawColl - result.rawColls;
    }
    uint256 collShareToRebalance = _convertToCollShares(result.rawColls + result.bonusRawColls, cachedCollIndex);

    _liquidateTick(tick, collShareToRebalance, debtShareToRebalance);
    unchecked {
      (uint256 totalDebts, uint256 totalColls) = _getDebtAndCollateralShares();
      _updateDebtAndCollateralShares(totalDebts - debtShareToRebalance, totalColls - collShareToRebalance);
    }
  }

  /// @inheritdoc IPool
  function rebalance(
    uint32 positionId,
    uint256 maxRawDebts
  ) external onlyPoolManager returns (RebalanceResult memory result) {
    (uint256 cachedCollIndex, uint256 cachedDebtIndex) = _updateCollAndDebtIndex();
    (, uint256 price, ) = IPriceOracle(priceOracle).getPrice(); // use min price
    PositionInfo memory position = _getAndUpdatePosition(positionId);
    uint256 positionRawColl = _convertToRawColl(position.colls, cachedCollIndex);
    uint256 positionRawDebt = _convertToRawDebt(position.debts, cachedDebtIndex);
    (uint256 rebalanceDebtRatio, uint256 rebalanceBonusRatio) = _getRebalanceRatios();
    // rebalance only debt ratio >= `rebalanceDebtRatio`
    if (positionRawDebt * PRECISION * PRECISION < rebalanceDebtRatio * positionRawColl * price) {
      revert ErrorRebalanceDebtRatioNotReached();
    }
    _removePositionFromTick(position);

    // compute debts to rebalance to make debt ratio to `rebalanceDebtRatio`
    result.rawDebts = _getRawDebtToRebalance(
      positionRawColl,
      positionRawDebt,
      price,
      rebalanceDebtRatio,
      rebalanceBonusRatio
    );
    if (maxRawDebts < result.rawDebts) result.rawDebts = maxRawDebts;

    uint256 debtShareToRebalance = _convertToDebtShares(result.rawDebts, cachedDebtIndex);
    result.rawColls = (result.rawDebts * PRECISION) / price;
    result.bonusRawColls = (result.rawColls * rebalanceBonusRatio) / FEE_PRECISION;
    if (result.bonusRawColls > positionRawColl - result.rawColls) {
      result.bonusRawColls = positionRawColl - result.rawColls;
    }
    uint256 collShareToRebalance = _convertToCollShares(result.rawColls + result.bonusRawColls, cachedCollIndex);
    position.debts -= uint104(debtShareToRebalance);
    position.colls -= uint104(collShareToRebalance);

    {
      int256 tick;
      (tick, position.nodeId) = _addPositionToTick(position.colls, position.debts, false);
      position.tick = int16(tick);
    }
    positionData[positionId] = position;
    unchecked {
      (uint256 totalDebts, uint256 totalColls) = _getDebtAndCollateralShares();
      _updateDebtAndCollateralShares(totalDebts - debtShareToRebalance, totalColls - collShareToRebalance);
    }
  }

  /// @inheritdoc IPool
  function liquidate(
    uint256 positionId,
    uint256 maxRawDebts,
    uint256 reservedRawColls
  ) external onlyPoolManager returns (LiquidateResult memory result) {
    (uint256 cachedCollIndex, uint256 cachedDebtIndex) = _updateCollAndDebtIndex();
    (, uint256 price, ) = IPriceOracle(priceOracle).getPrice(); // use min price
    PositionInfo memory position = _getAndUpdatePosition(positionId);
    uint256 positionRawColl = _convertToRawColl(position.colls, cachedCollIndex);
    uint256 positionRawDebt = _convertToRawDebt(position.debts, cachedDebtIndex);
    uint256 liquidateBonusRatio;
    // liquidate only debt ratio >= `liquidateDebtRatio`
    {
      uint256 liquidateDebtRatio;
      (liquidateDebtRatio, liquidateBonusRatio) = _getLiquidateRatios();
      if (positionRawDebt * PRECISION * PRECISION < liquidateDebtRatio * positionRawColl * price) {
        revert ErrorLiquidateDebtRatioNotReached();
      }
    }

    _removePositionFromTick(position);

    result.rawDebts = positionRawDebt;
    if (result.rawDebts > maxRawDebts) result.rawDebts = maxRawDebts;
    uint256 debtShareToLiquidate = result.rawDebts == positionRawDebt
      ? position.debts
      : _convertToDebtShares(result.rawDebts, cachedDebtIndex);
    uint256 collShareToLiquidate;
    result.rawColls = (result.rawDebts * PRECISION) / price;
    result.bonusRawColls = (result.rawColls * liquidateBonusRatio) / FEE_PRECISION;
    if (result.bonusRawColls > positionRawColl - result.rawColls) {
      uint256 diff = result.bonusRawColls - (positionRawColl - result.rawColls);
      if (diff < reservedRawColls) result.bonusFromReserve = diff;
      else result.bonusFromReserve = reservedRawColls;
      result.bonusRawColls = positionRawColl - result.rawColls + result.bonusFromReserve;

      collShareToLiquidate = position.colls;
    } else {
      collShareToLiquidate = _convertToCollShares(result.rawColls + result.bonusRawColls, cachedCollIndex);
    }
    position.debts -= uint104(debtShareToLiquidate);
    position.colls -= uint104(collShareToLiquidate);

    unchecked {
      (uint256 totalDebts, uint256 totalColls) = _getDebtAndCollateralShares();
      _updateDebtAndCollateralShares(totalDebts - debtShareToLiquidate, totalColls - collShareToLiquidate);
    }

    // try distribute bad debts
    if (position.colls == 0 && position.debts > 0) {
      (uint256 totalDebts, ) = _getDebtAndCollateralShares();
      totalDebts -= position.debts;
      _updateDebtShares(totalDebts);
      uint256 rawBadDebt = _convertToRawDebt(position.debts, cachedDebtIndex);
      _updateDebtIndex(cachedDebtIndex + (rawBadDebt * E128) / totalDebts);
      position.debts = 0;
    }
    {
      int256 tick;
      (tick, position.nodeId) = _addPositionToTick(position.colls, position.debts, false);
      position.tick = int16(tick);
    }
    positionData[positionId] = position;
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Update the borrow and redeem status.
  /// @param borrowStatus The new borrow status.
  /// @param redeemStatus The new redeem status.
  function updateBorrowAndRedeemStatus(bool borrowStatus, bool redeemStatus) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateBorrowStatus(borrowStatus);
    _updateRedeemStatus(redeemStatus);
  }

  /// @notice Update debt ratio range.
  /// @param minRatio The minimum allowed debt ratio to update, multiplied by 1e18.
  /// @param maxRatio The maximum allowed debt ratio to update, multiplied by 1e18.
  function updateDebtRatioRange(uint256 minRatio, uint256 maxRatio) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateDebtRatioRange(minRatio, maxRatio);
  }

  /// @notice Update maximum redeem ratio per tick.
  /// @param ratio The ratio to update, multiplied by 1e9.
  function updateMaxRedeemRatioPerTick(uint256 ratio) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateMaxRedeemRatioPerTick(ratio);
  }

  /// @notice Update ratio for rebalance.
  /// @param debtRatio The minimum debt ratio to start rebalance, multiplied by 1e18.
  /// @param bonusRatio The bonus ratio during rebalance, multiplied by 1e9.
  function updateRebalanceRatios(uint256 debtRatio, uint256 bonusRatio) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateRebalanceRatios(debtRatio, bonusRatio);
  }

  /// @notice Update ratio for liquidate.
  /// @param debtRatio The minimum debt ratio to start liquidate, multiplied by 1e18.
  /// @param bonusRatio The bonus ratio during liquidate, multiplied by 1e9.
  function updateLiquidateRatios(uint256 debtRatio, uint256 bonusRatio) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateLiquidateRatios(debtRatio, bonusRatio);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to compute the amount of debt to rebalance to reach certain debt ratio.
  /// @param coll The amount of collateral tokens.
  /// @param debt The amount of debt tokens.
  /// @param price The price of the collateral token.
  /// @param targetDebtRatio The target debt ratio, multiplied by 1e18.
  /// @param incentiveRatio The bonus ratio, multiplied by 1e9.
  /// @return rawDebts The amount of debt tokens to rebalance.
  function _getRawDebtToRebalance(
    uint256 coll,
    uint256 debt,
    uint256 price,
    uint256 targetDebtRatio,
    uint256 incentiveRatio
  ) internal pure returns (uint256 rawDebts) {
    // we have
    //   1. (debt - x) / (price * (coll - y * (1 + incentive))) <= target_ratio
    //   2. debt / (price * coll) >= target_ratio
    // then
    // => debt - x <= target * price * (coll - y * (1 + incentive)) and y = x / price
    // => debt - target_ratio * price * coll <= (1 - (1 + incentive) * target) * x
    // => x >= (debt - target_ratio * price * coll) / (1 - (1 + incentive) * target)
    rawDebts =
      (debt * PRECISION * PRECISION - targetDebtRatio * price * coll) /
      (PRECISION * PRECISION - (PRECISION * targetDebtRatio * (FEE_PRECISION + incentiveRatio)) / FEE_PRECISION);
  }
  
  /// @dev Internal function to update collateral and debt index.
  /// @return newCollIndex The updated collateral index.
  /// @return newDebtIndex The updated debt index.
  function _updateCollAndDebtIndex() internal virtual returns (uint256 newCollIndex, uint256 newDebtIndex);
  
  /// @dev Internal function to compute the protocol fees.
  /// @param rawColl The amount of collateral tokens involved.
  /// @return fees The expected protocol fees.
  function _deductProtocolFees(int256 rawColl) internal view virtual returns (uint256 fees);

  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   */
  uint256[50] private __gap;
}
