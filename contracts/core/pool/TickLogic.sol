// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { WordCodec } from "../../common/codec/WordCodec.sol";
import { TickBitmap } from "../../libraries/TickBitmap.sol";
import { TickMath } from "../../libraries/TickMath.sol";
import { PoolStorage } from "./PoolStorage.sol";

abstract contract TickLogic is PoolStorage {
  using TickBitmap for mapping(int8 => uint256);
  using WordCodec for bytes32;

  function __TickLogic_init() internal onlyInitializing {
    nextTreeNodeId = 1;
    topTick = type(int16).min;
  }

  function _getRootNode(uint256 node) internal view returns (uint256 root, uint256 collRatio, uint256 debtRatio) {
    collRatio = E60;
    debtRatio = E60;
    while (true) {
      bytes32 metadata = tickTreeData[node].metadata;
      uint256 parent = metadata.decodeUint(0, 32);
      collRatio = (collRatio * metadata.decodeUint(48, 64)) >> 60;
      debtRatio = (debtRatio * metadata.decodeUint(112, 64)) >> 60;
      if (parent == 0) break;
      node = uint32(parent);
    }
    root = node;
  }

  function _getRootNodeAndCompress(uint256 node) internal returns (uint256 root, uint256 collRatio, uint256 debtRatio) {
    // @todo Change it to non-recursive version to avoid stack overflow.
    bytes32 metadata = tickTreeData[node].metadata;
    uint256 parent = metadata.decodeUint(0, 32);
    collRatio = metadata.decodeUint(48, 64);
    debtRatio = debtRatio * metadata.decodeUint(112, 64);
    if (parent == 0) {
      root = parent;
    } else {
      uint256 collRatioCompressed;
      uint256 debtRatioCompressed;
      (root, collRatioCompressed, debtRatioCompressed) = _getRootNodeAndCompress(parent);
      collRatio = (collRatio * collRatioCompressed) >> 60;
      debtRatio = (debtRatio * debtRatioCompressed) >> 60;
      metadata = metadata.insertUint(collRatio, 48, 64);
      metadata = metadata.insertUint(debtRatio, 112, 64);
      tickTreeData[node].metadata = metadata;
    }
  }

  function _newTickTreeNode(int16 tick) internal returns (uint32 node) {
    node = nextTreeNodeId;
    nextTreeNodeId = node + 1;
    tickData[tick] = node;

    bytes32 metadata = bytes32(0);
    metadata = metadata.insertInt(tick, 32, 16); // set tick
    metadata = metadata.insertUint(PRECISION, 48, 64); // set coll ratio
    metadata = metadata.insertUint(PRECISION, 112, 64); // set debt ratio
    tickTreeData[node].metadata = metadata;
  }

  // find first tick such that TickMath.getRatioAtTick(tick) >= ratio
  function _getTick(uint256 colls, uint256 debts) internal pure returns (int256 tick) {
    uint256 ratio = (debts * TickMath.ZERO_TICK_SCALED_RATIO) / colls;
    uint256 ratioAtTick;
    (tick, ratioAtTick) = TickMath.getTickAtRatio(ratio);
    if (ratio != ratioAtTick) {
      tick++;
      ratio = (ratioAtTick * 10015) / 10000;
    }
  }

  function _getOrCreateTickNode(int256 tick) internal returns (uint32 node) {
    node = tickData[tick];
    if (node == 0) {
      node = _newTickTreeNode(int16(tick));
    }
  }

  function _addPositionToTick(
    uint256 colls,
    uint256 debts,
    bool checkDebts
  ) internal returns (int256 tick, uint32 node) {
    if (debts > 0) {
      if (checkDebts && int256(debts) < MIN_DEBT) revert();

      tick = _getTick(colls, debts);
      node = _getOrCreateTickNode(tick);
      bytes32 value = tickTreeData[node].value;
      uint256 newColls = value.decodeUint(0, 128) + colls;
      uint256 newDebts = value.decodeUint(128, 128) + debts;
      value = value.insertUint(newColls, 0, 128);
      value = value.insertUint(newDebts, 128, 128);
      tickTreeData[node].value = value;

      if (newDebts == debts) {
        tickBitmap.flipTick(int16(tick));
      }

      // update top tick
      if (tick > topTick) topTick = int16(tick);
    }
  }

  function _removePositionFromTick(PositionInfo memory position) internal {
    if (position.nodeId == 0) return;

    bytes32 value = tickTreeData[position.nodeId].value;
    uint256 newColls = value.decodeUint(0, 128) - position.colls;
    uint256 newDebts = value.decodeUint(128, 128) - position.debts;
    value = value.insertUint(newColls, 0, 128);
    value = value.insertUint(newDebts, 128, 128);
    tickTreeData[position.nodeId].value = value;

    if (newDebts == 0) {
      int16 tick = int16(tickTreeData[position.nodeId].metadata.decodeInt(32, 16));
      tickBitmap.flipTick(tick);
    }
  }

  /// @dev caller make sure max(liquidatedColl, liquidatedDebt) > 0
  function _liquidateTick(
    int16 tick,
    uint256 liquidatedColl,
    uint256 liquidatedDebt
  ) internal returns (int256 nextTick) {
    uint32 node = tickData[tick];
    // create new tree node for this tick
    _newTickTreeNode(tick);
    tickBitmap.flipTick(tick);

    bytes32 value = tickTreeData[node].value;
    bytes32 metadata = tickTreeData[node].metadata;
    uint256 tickColl = value.decodeUint(0, 128) - liquidatedColl;
    uint256 tickDebt = value.decodeUint(128, 128) - liquidatedDebt;
    uint256 collRatio = (tickColl * PRECISION) / tickColl;
    uint256 debtRatio = (tickDebt * PRECISION) / tickDebt;

    // update metadata
    metadata = metadata.insertUint(collRatio, 48, 64);
    metadata = metadata.insertUint(debtRatio, 112, 64);

    if (tickDebt > 0) {
      // partial liquidated, move funds to another tick
      uint32 parentNode;
      (nextTick, parentNode) = _addPositionToTick(tickColl, tickDebt, false);
      metadata = metadata.insertUint(parentNode, 0, 32);
    } else {
      // all liquidate
      nextTick = tick - 1;
    }
    tickTreeData[node].metadata = metadata;
  }

  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   */
  uint256[50] private __gap;
}
