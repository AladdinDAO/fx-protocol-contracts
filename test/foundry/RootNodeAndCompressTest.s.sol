// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { Test } from "forge-std/Test.sol";

import { WordCodec } from "../../contracts/common/codec/WordCodec.sol";
import { TickMath } from "../../contracts/libraries/TickMath.sol";

contract MinimumPool {
  using WordCodec for bytes32;

  /// @dev bit operation related constants
  uint256 internal constant E60 = 2 ** 60; // 2^60

  /// @dev Below are offsets of each variables in `TickTreeNode.metadata`.
  uint256 private constant PARENT_OFFSET = 0;
  uint256 private constant TICK_OFFSET = 48;
  uint256 private constant COLL_RATIO_OFFSET = 64;
  uint256 private constant DEBT_RATIO_OFFSET = 128;

  /// @dev Below are offsets of each variables in `TickTreeNode.value`.
  uint256 internal constant COLL_SHARE_OFFSET = 0;
  uint256 internal constant DEBT_SHARE_OFFSET = 128;

  /// @dev The compiler will pack it into two `uint256`.
  /// @param metadata The metadata for tree node.
  ///   ```text
  ///   * Field           Bits    Index       Comments
  ///   * parent          48      0           The index for parent tree node.
  ///   * tick            16      48          The original tick for this tree node.
  ///   * coll ratio      64      64          The remained coll share ratio base on parent node, the value is real ratio * 2^60.
  ///   * debt ratio      64      128         The remained debt share ratio base on parent node, the value is real ratio * 2^60.
  ///   ```
  /// @param value The value for tree node
  ///   ```text
  ///   * Field           Bits    Index       Comments
  ///   * coll share      128     0           The original total coll share before rebalance or redeem.
  ///   * debt share      128     128         The original total debt share before rebalance or redeem.
  ///   ```
  struct TickTreeNode {
    bytes32 metadata;
    bytes32 value;
  }

  uint256 public nextTreeNodeId;

  /// @dev Mapping from tree node id to tree node data.
  mapping(uint256 => TickTreeNode) public tickTreeData;

  constructor() {
    nextTreeNodeId = 1;
  }

  /// @dev Internal function to get the root of the given tree node.
  /// @param node The id of the given tree node.
  /// @return root The root node id.
  /// @return collRatio The actual collateral ratio of the given node, multiplied by 2^60.
  /// @return debtRatio The actual debt ratio of the given node, multiplied by 2^60.
  function getRootNode(uint256 node) external view returns (uint256 root, uint256 collRatio, uint256 debtRatio) {
    collRatio = E60;
    debtRatio = E60;
    while (true) {
      bytes32 metadata = tickTreeData[node].metadata;
      uint256 parent = metadata.decodeUint(PARENT_OFFSET, 48);
      collRatio = (collRatio * metadata.decodeUint(COLL_RATIO_OFFSET, 64)) >> 60;
      debtRatio = (debtRatio * metadata.decodeUint(DEBT_RATIO_OFFSET, 64)) >> 60;
      if (parent == 0) break;
      node = parent;
    }
    root = node;
  }

  /// @dev Internal function to create a new tree node.
  /// @param tick The tick where this tree node belongs to.
  /// @return node The created tree node id.
  function newTickTreeNode(
    uint48 parentNode,
    int16 tick,
    uint256 collRatio,
    uint256 debtRatio
  ) external returns (uint48 node) {
    unchecked {
      node = uint48(nextTreeNodeId);
      nextTreeNodeId += 1;
    }

    bytes32 metadata = bytes32(0);
    metadata = metadata.insertInt(tick, TICK_OFFSET, 16); // set tick
    metadata = metadata.insertUint(collRatio, COLL_RATIO_OFFSET, 64); // set coll ratio
    metadata = metadata.insertUint(debtRatio, DEBT_RATIO_OFFSET, 64); // set debt ratio
    metadata = metadata.insertUint(parentNode, PARENT_OFFSET, 48);
    tickTreeData[node].metadata = metadata;
  }

  /// @dev Internal function to get the root of the given tree node and compress path.
  /// @param node The id of the given tree node.
  /// @return root The root node id.
  /// @return collRatio The actual collateral ratio of the given node, multiplied by 2^60.
  /// @return debtRatio The actual debt ratio of the given node, multiplied by 2^60.
  function getRootNodeAndCompress(uint256 node) public returns (uint256 root, uint256 collRatio, uint256 debtRatio) {
    // @note We can change it to non-recursive version to avoid stack overflow. Normally, the depth should be `log(n)`,
    // where `n` is the total number of tree nodes. So we don't need to worry much about this.
    bytes32 metadata = tickTreeData[node].metadata;
    uint256 parent = metadata.decodeUint(PARENT_OFFSET, 48);
    collRatio = metadata.decodeUint(COLL_RATIO_OFFSET, 64);
    debtRatio = metadata.decodeUint(DEBT_RATIO_OFFSET, 64);
    if (parent == 0) {
      root = node;
    } else {
      uint256 collRatioCompressed;
      uint256 debtRatioCompressed;
      (root, collRatioCompressed, debtRatioCompressed) = getRootNodeAndCompress(parent);
      collRatio = (collRatio * collRatioCompressed) >> 60;
      debtRatio = (debtRatio * debtRatioCompressed) >> 60;
      metadata = metadata.insertUint(root, PARENT_OFFSET, 48);
      metadata = metadata.insertUint(collRatio, COLL_RATIO_OFFSET, 64);
      metadata = metadata.insertUint(debtRatio, DEBT_RATIO_OFFSET, 64);
      tickTreeData[node].metadata = metadata;
    }
  }

  /// @dev Internal function to get the root of the given tree node and compress path non-recursively.
  /// @param node The id of the given tree node.
  /// @return root The root node id.
  /// @return collRatio The actual collateral ratio of the given node, multiplied by 2^60.
  /// @return debtRatio The actual debt ratio of the given node, multiplied by 2^60.
  function getRootNodeAndCompressNonRecursive(
    uint256 node
  ) external returns (uint256 root, uint256 collRatio, uint256 debtRatio) {
    uint256 depth;
    bytes32 metadata;
    root = node;
    while (true) {
      // @dev no need to clean the transient storage, it will be overwritten.
      assembly {
        tstore(depth, root)
        depth := add(depth, 1)
      }
      metadata = tickTreeData[root].metadata;
      uint256 parent = metadata.decodeUint(PARENT_OFFSET, 48);
      if (parent == 0) break;
      root = parent;
    }
    // depth - 1
    metadata = tickTreeData[root].metadata;
    collRatio = metadata.decodeUint(COLL_RATIO_OFFSET, 64);
    debtRatio = metadata.decodeUint(DEBT_RATIO_OFFSET, 64);
    if (depth > 1) {
      for (uint256 i = depth - 2; ; --i) {
        assembly {
          node := tload(i)
        }
        metadata = tickTreeData[node].metadata;
        collRatio = (collRatio * metadata.decodeUint(COLL_RATIO_OFFSET, 64)) >> 60;
        debtRatio = (debtRatio * metadata.decodeUint(DEBT_RATIO_OFFSET, 64)) >> 60;
        metadata = metadata.insertUint(root, PARENT_OFFSET, 48);
        metadata = metadata.insertUint(collRatio, COLL_RATIO_OFFSET, 64);
        metadata = metadata.insertUint(debtRatio, DEBT_RATIO_OFFSET, 64);
        tickTreeData[node].metadata = metadata;
        if (i == 0) break;
      }
    }
  }
}

contract RootNodeAndCompressTest is Test {
  /// @dev bit operation related constants
  uint256 internal constant E60 = 2 ** 60; // 2^60

  MinimumPool private pool1;
  MinimumPool private pool2;

  function setUp() public {
    pool1 = new MinimumPool();
    pool2 = new MinimumPool();

    // create root node
    pool1.newTickTreeNode(0, 0, E60, E60);
    pool2.newTickTreeNode(0, 0, E60, E60);
  }

  function init(uint256 seed) internal {
    assertEq(pool1.nextTreeNodeId(), 2);
    assertEq(pool2.nextTreeNodeId(), 2);
    // create 1000 nodes
    for (uint256 i = 0; i < 1000; ++i) {
      uint256 nextNodeId = pool1.nextTreeNodeId();
      uint48 parentNode = uint48(bound(seed, 1, nextNodeId - 1));
      seed = uint256(keccak256(abi.encodePacked(seed, i)));
      uint64 collRatio = uint64(bound(seed, 0, E60));
      seed = uint256(keccak256(abi.encodePacked(seed, i)));
      uint64 debtRatio = uint64(bound(seed, 0, E60));
      seed = uint256(keccak256(abi.encodePacked(seed, i)));
      int16 tick = int16(bound(int256(seed), int256(TickMath.MIN_TICK), int256(TickMath.MAX_TICK)));
      seed = uint256(keccak256(abi.encodePacked(seed, i)));

      pool1.newTickTreeNode(parentNode, tick, collRatio, debtRatio);
      pool2.newTickTreeNode(parentNode, tick, collRatio, debtRatio);
    }
  }

  function check() internal {
    assertEq(pool1.nextTreeNodeId(), pool2.nextTreeNodeId());
    uint256 nextNodeId = pool1.nextTreeNodeId();
    for (uint256 node = 1; node <= nextNodeId; ++node) {
      // test getRootNode is the same
      (uint256 root1, uint256 collRatio1, uint256 debtRatio1) = pool1.getRootNode(node);
      (uint256 root2, uint256 collRatio2, uint256 debtRatio2) = pool2.getRootNode(node);
      assertEq(root1, root2);
      assertEq(collRatio1, collRatio2);
      assertEq(debtRatio1, debtRatio2);
      // test tickTreeData is the same
      (bytes32 metadata1, bytes32 value1) = pool1.tickTreeData(node);
      (bytes32 metadata2, bytes32 value2) = pool2.tickTreeData(node);
      assertEq(metadata1, metadata2);
      assertEq(value1, value2);
    }
  }

  function test(uint256 seed, uint256 times) external {
    times = bound(times, 1, 500);
    init(seed);
    check();
    for (uint256 i = 0; i < times; ++i) {
      uint256 node = bound(seed, 1, pool1.nextTreeNodeId() - 1);
      seed = uint256(keccak256(abi.encodePacked(seed, i)));
      (uint256 root1, uint256 collRatio1, uint256 debtRatio1) = pool1.getRootNodeAndCompress(node);
      (uint256 root2, uint256 collRatio2, uint256 debtRatio2) = pool2.getRootNodeAndCompressNonRecursive(node);
      assertEq(root1, root2);
      assertEq(collRatio1, collRatio2);
      assertEq(debtRatio1, debtRatio2);
    }
    check();
  }
}
