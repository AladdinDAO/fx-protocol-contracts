// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IGovernanceToken is IERC20Metadata {
  /// @notice Mint token to given address.
  /// @param to The address of token receiver.
  /// @param amount The amount of token to mint.
  function mint(address to, uint256 amount) external;
}
