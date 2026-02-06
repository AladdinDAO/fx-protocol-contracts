// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { SpotPriceOracleBase } from "./SpotPriceOracleBase.sol";

import { IRateProvider } from "../rate-provider/interfaces/IRateProvider.sol";

/// @title WeETH Rate Provider
/// @notice Provides the exchange rate from WeETH to ETH
contract WeETHRateProvider is SpotPriceOracleBase, IRateProvider {
  /***********************
   * Immutable Variables *
   ***********************/

  /// @dev The Chainlink price feed for WeETH/ETH spot price.
  bytes32 private Chainlink_WEETH_ETH_Spot;

  /***************
   * Constructor *
   ***************/

  /// @notice Constructor
  constructor(address _spotPriceOracle, bytes32 _Chainlink_WEETH_ETH_Spot) SpotPriceOracleBase(_spotPriceOracle) {
    Chainlink_WEETH_ETH_Spot = _Chainlink_WEETH_ETH_Spot;
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc IRateProvider
  /// @notice Returns the exchange rate from WeETH to ETH, multiplied by 1e18
  function getRate() external view returns (uint256) {
    return _readSpotPriceByChainlink(Chainlink_WEETH_ETH_Spot);
  }
}
