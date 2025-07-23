// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IPool } from "./IPool.sol";

interface IShortPool is IPool {
  /*************************
   * Public View Functions *
   *************************/

  /// @notice The address of the debt token.
  function debtToken() external view returns (address);

  /// @notice The address of the credit note token.
  function creditNote() external view returns (address);

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Whether the pool is under collateral.
  /// @return underCollateral Whether the pool is under collateral.
  /// @return shortfall The amount of shortfall raw debt token.
  function isUnderCollateral() external returns (bool underCollateral, uint256 shortfall);

  /// @notice Kill the pool.
  function kill() external;

  /// @notice Redeem credit note to get collateral tokens.
  /// @param creditNoteAmount The amount of credit note to redeem.
  /// @return rawColls The amount of collateral tokens to redeemed.
  function redeemByCreditNote(uint256 creditNoteAmount) external returns (uint256 rawColls);
}
