// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IFxUSDPriceOracle {
  /**********
   * Events *
   **********/

  /// @notice Emitted when the curve pool contract is updated.
  /// @param oldPool The address of previous curve pool contract.
  /// @param newPool The address of current curve pool contract.
  event UpdateCurvePool(address indexed oldPool, address indexed newPool);

  /// @notice Emitted when the max price deviation is updated.
  /// @param oldDePegDeviation The value of previous depeg price deviation
  /// @param oldUpPegDeviation The value of previous up peg price deviation
  /// @param newDePegDeviation The value of current depeg price deviation
  /// @param newUpPegDeviation The value of current up peg price deviation
  event UpdateMaxPriceDeviation(
    uint256 oldDePegDeviation,
    uint256 oldUpPegDeviation,
    uint256 newDePegDeviation,
    uint256 newUpPegDeviation
  );

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Get the current price of FXUSD
  /// @return isPegged Whether the price is currently pegged to 1 USD
  /// @return price The current price of FXUSD in USD, multiplied by 1e18
  function getPrice() external view returns (bool isPegged, uint256 price);

  /// @notice Check if the current price is above the maximum allowed deviation from 1 USD
  /// @return True if the price is above the maximum deviation threshold, false otherwise
  function isPriceAboveMaxDeviation() external view returns (bool);

  /// @notice Check if the current price is below the maximum allowed deviation from 1 USD
  /// @return True if the price is below the maximum deviation threshold, false otherwise
  function isPriceBelowMaxDeviation() external view returns (bool);
}
