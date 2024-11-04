// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IPegKeeper } from "../../interfaces/IPegKeeper.sol";
import { IPool } from "../../interfaces/IPool.sol";
import { IPoolManager } from "../../interfaces/IPoolManager.sol";
import { IPriceOracle } from "../../interfaces/IPriceOracle.sol";

import { WordCodec } from "../../common/codec/WordCodec.sol";
import { TickBitmap } from "../../libraries/TickBitmap.sol";
import { PositionLogic } from "./PositionLogic.sol";
import { TickLogic } from "./TickLogic.sol";

abstract contract BasePool is TickLogic, PositionLogic {
  using TickBitmap for mapping(int8 => uint256);
  using WordCodec for bytes32;

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

  modifier onlyPoolManager() {
    if (_msgSender() != poolManager) revert();
    _;
  }

  constructor(address _poolManager) {
    poolManager = _poolManager;
    fxUSD = IPoolManager(_poolManager).fxUSD();
    pegKeeper = IPoolManager(_poolManager).pegKeeper();
  }

  function __BasePool_init() internal onlyInitializing {
    debtIndex = E128;
    collIndex = E128;
  }

  function operate(
    uint256 positionId,
    int256 newRawColl,
    int256 newRawDebt,
    address owner
  ) external onlyPoolManager returns (uint256, int256, int256, uint256) {
    if (newRawColl == 0 && newRawDebt == 0) {
      revert();
    }
    if (newRawColl != 0 && (newRawColl > -MIN_COLLATERAL && newRawColl < MIN_COLLATERAL)) {
      revert();
    }
    if (newRawDebt != 0 && (newRawDebt > -MIN_DEBT && newRawDebt < MIN_DEBT)) {
      revert();
    }
    if (newRawDebt > 0 && (isBorrowPaused || !IPegKeeper(pegKeeper).isBorrowAllowed())) {
      revert();
    }

    OperationMemoryVar memory op;
    op.globalColl = totalColls;
    op.globalDebt = totalDebts;
    if (positionId == 0) {
      positionId = _mintPosition(owner);
    } else {
      // checking owner only in case of withdraw or borrow
      if ((newRawColl < 0 || newRawDebt > 0) && ownerOf(positionId) != owner) {
        revert();
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
        if (uint256(-op.newColl) > op.positionColl) revert();
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
      if (rawDebts * PRECISION * PRECISION > maxDebtRatio * rawColls * price) revert();
      if (rawDebts * PRECISION * PRECISION < minDebtRatio * rawColls * price) revert();

      // if global debt ratio >= 1, only allow supply and repay
      rawColls = _convertToRawColl(op.globalColl, op.collIndex);
      rawDebts = _convertToRawDebt(op.globalDebt, op.debtIndex);
      if (rawDebts * PRECISION >= rawColls * price) {
        if (newRawColl < 0 || newRawDebt > 0) revert();
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
    totalColls = op.globalColl;
    totalDebts = op.globalDebt;

    if (newRawColl > 0) {
      newRawColl -= int256(protocolFees);
    } else if (newRawColl < 0) {
      newRawColl += int256(protocolFees);
    }

    return (positionId, newRawColl, newRawDebt, protocolFees);
  }

  function redeem(uint256 rawDebts) external onlyPoolManager returns (uint256 rawColls) {
    if (isRedeemPaused) revert();

    (uint256 cachedCollIndex, uint256 cachedDebtIndex) = _updateCollAndDebtIndex();
    (, , uint256 price) = IPriceOracle(priceOracle).getPrice(); // use max price
    uint256 debtShare = _convertToDebtShares(rawDebts, cachedDebtIndex);

    int16 tick = topTick;
    bool hasDebt = true;

    uint256 cachedTotalColls = totalColls;
    uint256 cachedTotalDebts = totalDebts;
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
        uint256 debtShareToRedeem = (tickDebtShare * maxRedeemRatioPerTick) / FEE_PRECISION;
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
    totalColls = cachedTotalColls;
    totalDebts = cachedTotalDebts;
  }

  function rebalance(int16 tick, uint256 maxRawDebts) external onlyPoolManager returns (RebalanceResult memory result) {
    (uint256 cachedCollIndex, uint256 cachedDebtIndex) = _updateCollAndDebtIndex();
    (, uint256 price, ) = IPriceOracle(priceOracle).getPrice(); // use min price
    uint256 node = tickData[tick];
    bytes32 value = tickTreeData[node].value;
    uint256 tickRawColl = _convertToRawColl(value.decodeUint(0, 128), cachedCollIndex);
    uint256 tickRawDebt = _convertToRawDebt(value.decodeUint(128, 128), cachedDebtIndex);
    // rebalance only debt ratio >= `rebalanceDebtRatio`
    if (tickRawDebt * PRECISION * PRECISION < rebalanceDebtRatio * tickRawColl * price) revert();

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
    totalColls -= collShareToRebalance;
    totalDebts -= debtShareToRebalance;

    // @todo update topTick to save gas in redeem
  }

  function rebalance(
    uint32 positionId,
    uint256 maxRawDebts
  ) external onlyPoolManager returns (RebalanceResult memory result) {
    (uint256 cachedCollIndex, uint256 cachedDebtIndex) = _updateCollAndDebtIndex();
    (, uint256 price, ) = IPriceOracle(priceOracle).getPrice(); // use min price
    PositionInfo memory position = _getAndUpdatePosition(positionId);
    uint256 positionRawColl = _convertToRawColl(position.colls, cachedCollIndex);
    uint256 positionRawDebt = _convertToRawDebt(position.debts, cachedDebtIndex);
    // rebalance only debt ratio >= `rebalanceDebtRatio`
    if (positionRawDebt * PRECISION * PRECISION < rebalanceDebtRatio * positionRawColl * price) revert();
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

    int256 tick;
    (tick, position.nodeId) = _addPositionToTick(position.colls, position.debts, false);
    position.tick = int16(tick);
    positionData[positionId] = position;
    totalColls -= collShareToRebalance;
    totalDebts -= debtShareToRebalance;

    // @todo update topTick to save gas in redeem
  }

  function liquidate(
    uint256 positionId,
    uint256 maxRawDebts,
    uint256 reservedRawDebts
  ) external onlyPoolManager returns (LiquidateResult memory result) {
    (uint256 cachedCollIndex, uint256 cachedDebtIndex) = _updateCollAndDebtIndex();
    (, uint256 price, ) = IPriceOracle(priceOracle).getPrice(); // use min price
    PositionInfo memory position = _getAndUpdatePosition(positionId);
    uint256 positionRawColl = _convertToRawColl(position.colls, cachedCollIndex);
    uint256 positionRawDebt = _convertToRawDebt(position.debts, cachedDebtIndex);
    // liquidate only debt ratio >= `liquidateDebtRatio`
    if (positionRawDebt * PRECISION * PRECISION < liquidateDebtRatio * positionRawColl * price) revert();
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
      if (diff < reservedRawDebts) result.bonusFromReserve = diff;
      else result.bonusFromReserve = reservedRawDebts;
      result.bonusRawColls = positionRawColl - result.rawColls + result.bonusFromReserve;

      collShareToLiquidate = position.colls;
    } else {
      collShareToLiquidate = _convertToCollShares(result.rawColls + result.bonusRawColls, cachedCollIndex);
    }
    position.debts -= uint104(debtShareToLiquidate);
    position.colls -= uint104(collShareToLiquidate);

    totalColls -= collShareToLiquidate;
    totalDebts -= debtShareToLiquidate;

    // try distribute bad debts
    if (position.colls == 0 && position.debts > 0) {
      totalDebts -= position.debts;
      uint256 rawBadDebt = _convertToRawDebt(position.debts, cachedDebtIndex);
      debtIndex = cachedDebtIndex + (rawBadDebt * E128) / totalDebts;
      position.debts = 0;
    }
    {
      int256 tick;
      (tick, position.nodeId) = _addPositionToTick(position.colls, position.debts, false);
      position.tick = int16(tick);
    }
    positionData[positionId] = position;

    // @todo update topTick to save gas in redeem
  }

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

  function _updateCollAndDebtIndex() internal virtual returns (uint256 newCollIndex, uint256 newDebtIndex);

  function _deductProtocolFees(int256 rawColl) internal view virtual returns (uint256);

  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   */
  uint256[50] private __gap;
}
