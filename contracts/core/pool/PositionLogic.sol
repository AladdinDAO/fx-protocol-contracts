// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IPool } from "../../interfaces/IPool.sol";

import { TickLogic } from "./TickLogic.sol";

abstract contract PositionLogic is TickLogic {
  /***************
   * Constructor *
   ***************/

  function __PositionLogic_init() internal onlyInitializing {
    _updateNextPositionId(1);
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc IPool
  function getPosition(uint256 tokenId) external view returns (uint256 rawColls, uint256 rawDebts) {
    // compute actual shares
    PositionInfo memory position = positionData[tokenId];
    rawColls = position.colls;
    rawDebts = position.debts;
    if (position.nodeId > 0) {
      (, uint256 collRatio, uint256 debtRatio) = _getRootNode(position.nodeId);
      rawColls = (rawColls * collRatio) >> 60;
      rawDebts = (rawDebts * debtRatio) >> 60;
    }

    // convert shares to actual amount
    (uint256 debtIndex, uint256 collIndex) = _getDebtAndCollateralIndex();
    rawColls = _convertToRawColl(rawColls, collIndex);
    rawDebts = _convertToRawColl(rawDebts, debtIndex);
  }

  /// @inheritdoc IPool
  function getTotalRawColls() external view returns (uint256) {
    (, uint256 totalColls) = _getDebtAndCollateralShares();
    (, uint256 collIndex) = _getDebtAndCollateralIndex();
    return _convertToRawColl(totalColls, collIndex);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to mint a new position.
  /// @param owner The address of position owner.
  /// @return positionId The id of the position.
  function _mintPosition(address owner) internal returns (uint256 positionId) {
    unchecked {
      positionId = _getNextPositionId();
      _updateNextPositionId(positionId + 1);
    }

    _mint(owner, positionId);
  }

  /// @dev Internal function to get and update position.
  /// @param tokenId The id of the position.
  /// @return position The position struct.
  function _getAndUpdatePosition(uint256 tokenId) internal returns (PositionInfo memory position) {
    position = positionData[tokenId];
    if (position.nodeId > 0) {
      (uint256 root, uint256 collRatio, uint256 debtRatio) = _getRootNodeAndCompress(position.nodeId);
      position.colls = uint96((position.colls * collRatio) >> 60);
      position.debts = uint96((position.debts * debtRatio) >> 60);
      position.nodeId = uint32(root);
      positionData[tokenId] = position;
    }
  }

  /// @dev Internal function to convert raw collateral amounts to collateral shares.
  function _convertToCollShares(uint256 raw, uint256 index) internal pure returns (uint256 shares) {
    shares = (raw * index) / E128;
  }

  /// @dev Internal function to convert raw debt amounts to debt shares.
  function _convertToDebtShares(uint256 raw, uint256 index) internal pure returns (uint256 shares) {
    shares = (raw * E128) / index;
  }

  /// @dev Internal function to convert raw collateral shares to collateral amounts.
  function _convertToRawColl(uint256 shares, uint256 index) internal pure returns (uint256 raw) {
    raw = (shares * E128) / index;
  }

  /// @dev Internal function to convert raw debt shares to debt amounts.
  function _convertToRawDebt(uint256 shares, uint256 index) internal pure returns (uint256 raw) {
    raw = (shares * index) / E128;
  }

  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   */
  uint256[50] private __gap;
}
