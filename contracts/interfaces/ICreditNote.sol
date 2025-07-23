// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface ICreditNote {
  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Mint the credit note to the given address.
  /// @param to The address to mint the credit note to.
  /// @param amount The amount of credit note to mint.
  function mint(address to, uint256 amount) external;

  /// @notice Burn the credit note from the given address.
  /// @param from The address to burn the credit note from.
  /// @param amount The amount of credit note to burn.
  function burn(address from, uint256 amount) external;
}
