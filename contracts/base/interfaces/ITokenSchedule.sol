// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface ITokenSchedule {
  /**********
   * Events *
   **********/

  /// @notice Emitted when the gauge weight is updated.
  /// @param gauge The address of the gauge.
  /// @param oldWeight The value of previous gauge weight.
  /// @param newWeight The value of current gauge weight.
  event UpdateGaugeWeight(address indexed gauge, uint256 oldWeight, uint256 newWeight);

  /// @notice Emitted when gauge rewards are distributed.
  /// @param gauge The address of the gauge.
  /// @param rewards The amount of rewards distributed.
  event DistributeRewards(address indexed gauge, uint256 rewards);

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Return the current total gauge weight.
  function totalWeight() external view returns (uint256);

  /// @notice Return the list of gauges with non-zero weights.
  function getGauges() external view returns (address[] memory gauges);

  /// @notice Return the weight of given gauge.
  function getWeight(address gauge) external view returns (uint256);

  /// @notice Return the normalized weight of given gauge, multiplied by 1e18.
  function getNormalizedWeight(address gauge) external view returns (uint256);

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Distribute pending rewards to gauges.
  function distribute() external;
}
