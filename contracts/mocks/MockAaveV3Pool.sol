// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IAaveV3Pool } from "../interfaces/Aave/IAaveV3Pool.sol";

contract MockAaveV3Pool is IAaveV3Pool {
  uint128 public variableBorrowRate;

  constructor(uint128 _variableBorrowRate) {
    variableBorrowRate = _variableBorrowRate;
  }

  function setVariableBorrowRate(uint128 _variableBorrowRate) external {
    variableBorrowRate = _variableBorrowRate;
  }

  function getReserveData(address) external view returns (ReserveDataLegacy memory result) {
    result.currentVariableBorrowRate = variableBorrowRate;
  }
}
