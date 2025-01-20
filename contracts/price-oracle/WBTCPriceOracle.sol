// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { Math } from "@openzeppelin/contracts-v4/utils/math/Math.sol";

import { SpotPriceOracleBase } from "./SpotPriceOracleBase.sol";
import { BTCDerivativeOracleBase } from "./BTCDerivativeOracleBase.sol";

contract FxWBTCOracleV2 is BTCDerivativeOracleBase {
  /*************
   * Constants *
   *************/

  /// @notice The encoding of the Chainlink WBTC/BTC Spot.
  bytes32 public immutable Chainlink_WBTC_BTC_Spot;

  /***************
   * Constructor *
   ***************/

  constructor(
    address _spotPriceOracle,
    bytes32 _Chainlink_BTC_USD_Spot,
    bytes32 _Chainlink_WBTC_BTC_Spot
  ) SpotPriceOracleBase(_spotPriceOracle) BTCDerivativeOracleBase(_Chainlink_BTC_USD_Spot) {
    Chainlink_WBTC_BTC_Spot = _Chainlink_WBTC_BTC_Spot;
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @inheritdoc BTCDerivativeOracleBase
  /// @dev [Chainlink BTC/USD spot] * [Chainlink WBTC/BTC spot]
  function _getBTCDerivativeUSDAnchorPrice() internal view virtual override returns (uint256) {
    uint256 BTC_USD_ChainlinkSpot = _readSpotPriceByChainlink(Chainlink_BTC_USD_Spot);
    uint256 WBTC_BTC_ChainlinkSpot = _readSpotPriceByChainlink(Chainlink_WBTC_BTC_Spot);
    return (WBTC_BTC_ChainlinkSpot * BTC_USD_ChainlinkSpot) / PRECISION;
  }
}
