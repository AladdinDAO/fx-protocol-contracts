// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

contract TokenSchedule {
  uint256 constant private RATE_REDUCTION_TIME = 365 days;
  
  uint256 constant private RATE_DENOMINATOR = 10 ** 18;

  uint256 constant private INFLATION_DELAY = 86400;

  uint256 immutable public INITIAL_RATE;

  uint256 immutable public RATE_REDUCTION_COEFFICIENT;

  address immutable public token;

  uint256 public mining_epoch;

  uint256 public start_epoch_time;

  uint256 public start_epoch_supply;

  uint256 public rate;

  function distribute() external {}
}
