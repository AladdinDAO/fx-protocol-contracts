// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ERC721Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";

import { PoolConstant } from "./PoolConstant.sol";

abstract contract PoolStorage is ERC721Upgradeable, AccessControlUpgradeable, PoolConstant {
  /// @dev if nodeId = 0, tick is not used and this position only has collateral
  struct PositionInfo {
    int16 tick;
    uint32 nodeId;
    uint104 colls;
    uint104 debts;
  }

  /// @dev The compiler will pack it into two `uint256`.
  /// @param metadata The metadata for tree node.
  ///   ```text
  ///   * Field           Bits    Index       Comments
  ///   * parent          32      0           The index for parent tree node.
  ///   * tick            16      32          The original tick for this tree node.
  ///   * coll ratio      64      48          The remained coll share ratio base on parent node, the value is real ratio * 2^60.
  ///   * debt ratio      64      112         The remained debt share ratio base on parent node, the value is real ratio * 2^60.
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

  address public collateralToken;

  address internal priceOracle;

  /// | position | top tick |
  /// | 32 bytes | 16  bits |
  bytes32 internal miscData;

  // for NFT
  mapping(uint256 => PositionInfo) internal positionData;
  uint256 public nextPositionId;

  // for ticks
  mapping(int8 => uint256) internal tickBitmap;

  // tick => tick data
  // | tree node id |
  // |   32  bits   |
  mapping(int256 => uint32) internal tickData;

  // tree node id => tree node data
  mapping(uint256 => TickTreeNode) internal tickTreeData;
  uint32 public nextTreeNodeId;

  int16 topTick;

  // this will only increase, starting from 2^128
  uint256 debtIndex;

  // this will only increase, starting from 2^128
  uint256 collIndex;

  uint256 totalColls;

  uint256 totalDebts;

  // 60 bits, max 1e18
  uint256 public minDebtRatio;

  // 60 bits, max 1e18
  uint256 public maxDebtRatio;

  // 60 bits, max 1e18
  uint256 public rebalanceDebtRatio;
  
  // 30 bits, max 1e9
  uint256 public rebalanceBonusRatio;

  // 60 bits, max 1e18
  uint256 public liquidateDebtRatio;

  // 30 bits, max 1e9
  uint256 public liquidateBonusRatio;
  
  bool public isBorrowPaused;

  bool public isRedeemPaused;

  // 30 bits, max 1e9
  uint256 public maxRedeemRatioPerTick;

  function supportsInterface(
    bytes4 interfaceId
  ) public view virtual override(AccessControlUpgradeable, ERC721Upgradeable) returns (bool) {
    return super.supportsInterface(interfaceId);
  }

  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   */
  uint256[50] private __gap;
}
