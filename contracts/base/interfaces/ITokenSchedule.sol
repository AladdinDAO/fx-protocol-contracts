// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface ITokenSchedule {
  function totalWeight() external view returns (uint256);

  function getGauges() external view returns (address[] memory gauges);

  function getWeight(address gauge) external view returns (uint256);

  function getNormalizedWeight(address gauge) external view returns (uint256);

  function distribute() external;
}
