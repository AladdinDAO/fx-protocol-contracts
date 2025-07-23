// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IPool } from "./IPool.sol";

interface ILongPool is IPool {
  /// @notice Reduce the collateral of the pool.
  /// @param rawAmount The amount of raw collateral to reduce.
  function reduceCollateral(uint256 rawAmount) external;
}
