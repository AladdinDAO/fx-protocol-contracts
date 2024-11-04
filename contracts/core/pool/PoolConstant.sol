// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IPool } from "../../interfaces/IPool.sol";

abstract contract PoolConstant is IPool {
  int256 internal constant MIN_COLLATERAL = 10000;

  int256 internal constant MIN_DEBT = 10000;

  uint256 internal constant PRECISION = 1e18;

  uint256 internal constant FEE_PRECISION = 1e9;

  uint256 internal constant E60 = 2 ** 60;
  uint256 internal constant E128 = 2 ** 128;

  uint256 internal constant X60 = 0xfffffffffffffff; // 2^60 - 1
  uint256 internal constant X128 = 0xffffffffffffffffffffffffffffffff; // 2^128 - 1

  address public immutable fxUSD;

  address public immutable poolManager;

  address public immutable pegKeeper;
}
