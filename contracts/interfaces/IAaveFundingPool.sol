// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IPool } from "./IPool.sol";

interface IAaveFundingPool is IPool {
  /**********
   * Events *
   **********/
   
   event SnapshotAaveInterestRate(uint256 rate, uint256 timestamp);

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Return the value of funding ratio, multiplied by 1e9.
  function getFundingRatio() external view returns (uint256);
}
