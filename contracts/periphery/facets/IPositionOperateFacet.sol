// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

interface IPositionOperateFacet {
  /// @notice Emitted when a position is operated.
  /// @param pool The address of the pool.
  /// @param positionId The index of the position.
  /// @param userCollateralsDelta The amount of collateral transferred from/to the user. Negative value means the user is transferring collateral to the position.
  /// @param userDebtsDelta The amount of debt transferred from/to the user. Negative value means the user is transferring debt to the position.
  /// @param newColl The new collateral amount of the position.
  /// @param newDebt The new debt amount of the position.
  event PositionOperate(
    address indexed pool,
    uint256 positionId,
    int256 userCollateralsDelta,
    int256 userDebtsDelta,
    int256 newColl,
    int256 newDebt
  );
}
