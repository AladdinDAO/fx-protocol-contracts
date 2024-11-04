// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { TickLogic } from "./TickLogic.sol";

abstract contract PositionLogic is TickLogic {
  function __PositionLogic_init() internal onlyInitializing {
    nextPositionId = 1;
  }

  function getPosition(uint256 tokenId) external view returns (uint256 rawColls, uint256 rawDebts) {
    PositionInfo memory position = positionData[tokenId];
    rawColls = position.colls;
    rawDebts = position.debts;
    if (position.nodeId > 0) {
      (, uint256 collRatio, uint256 debtRatio) = _getRootNode(position.nodeId);
      rawColls = (rawColls * collRatio) & X60;
      rawDebts = (rawDebts * debtRatio) & X60;
    }
  }

  function getTotalRawColls() external view returns (uint256) {
    return _convertToRawColl(totalColls, collIndex);
  }

  function _mintPosition(address owner) internal returns (uint256 positionId) {
    positionId = nextPositionId;
    unchecked {
      nextPositionId = positionId + 1;
    }

    _mint(owner, positionId);
  }

  function _getAndUpdatePosition(uint256 tokenId) internal returns (PositionInfo memory position) {
    position = positionData[tokenId];
    if (position.nodeId > 0) {
      (uint256 root, uint256 collRatio, uint256 debtRatio) = _getRootNodeAndCompress(position.nodeId);
      position.colls = uint96((position.colls * collRatio) & X60);
      position.debts = uint96((position.debts * debtRatio) & X60);
      position.nodeId = uint32(root);
      positionData[tokenId] = position;
    }
  }

  function _convertToCollShares(uint256 raw, uint256 index) internal pure returns (uint256 shares) {
    shares = (raw * index) / E128;
  }

  function _convertToDebtShares(uint256 raw, uint256 index) internal pure returns (uint256 shares) {
    shares = (raw * E128) / index;
  }

  function _convertToRawColl(uint256 shares, uint256 index) internal pure returns (uint256 raw) {
    raw = (shares * E128) / index;
  }

  function _convertToRawDebt(uint256 shares, uint256 index) internal pure returns (uint256 raw) {
    raw = (shares * index) / E128;
  }

  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   */
  uint256[50] private __gap;
}
