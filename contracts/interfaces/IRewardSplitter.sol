// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IRewardSplitter {
  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Split token to different RebalancePool.
  /// @param token The address of token to split.
  function split(address token) external;
}
