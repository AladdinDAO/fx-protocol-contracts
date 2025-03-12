// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { SpotPriceOracleBase } from "../../price-oracle/SpotPriceOracleBase.sol";

import { IPriceOracle } from "../../price-oracle/interfaces/IPriceOracle.sol";
import { ITwapOracle } from "../../price-oracle/interfaces/ITwapOracle.sol";

contract cbBTCPriceOracle is SpotPriceOracleBase, IPriceOracle {
  /*************
   * Constants *
   *************/

  /// @notice The Chainlink BTC/USD price feed.
  /// @dev See comments of `_readSpotPriceByChainlink` for more details.
  bytes32 public immutable Chainlink_BTC_USD_Spot;

  /*************
   * Variables *
   *************/

  /// @dev The encodings for cbBTC/USD spot sources.
  bytes private onchainSpotEncodings_cbBTCUSD;

  /// @notice The value of maximum price deviation, multiplied by 1e18.
  uint256 public maxPriceDeviation;

  /***************
   * Constructor *
   ***************/

  constructor(address _spotPriceOracle, bytes32 _Chainlink_BTC_USD_Spot) SpotPriceOracleBase(_spotPriceOracle) {
    Chainlink_BTC_USD_Spot = _Chainlink_BTC_USD_Spot;

    _updateMaxPriceDeviation(1e16); // 1%
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Return the cbBTC/USD spot price.
  /// @return chainlinkPrice The spot price from Chainlink price feed.
  /// @return minPrice The minimum spot price among all available sources.
  /// @return maxPrice The maximum spot price among all available sources.
  function getBTCUSDSpotPrice() external view returns (uint256 chainlinkPrice, uint256 minPrice, uint256 maxPrice) {
    (chainlinkPrice, minPrice, maxPrice) = _getBTCUSDSpotPrice();
  }

  /// @notice Return the cbBTC/USD spot prices.
  /// @return prices The list of spot price among all available sources, multiplied by 1e18.
  function getBTCUSDSpotPrices() external view returns (uint256[] memory prices) {
    prices = _getSpotPriceByEncoding(onchainSpotEncodings_cbBTCUSD);
  }

  /// @inheritdoc IPriceOracle
  /// @dev The price is valid iff |maxPrice-minPrice|/minPrice < maxPriceDeviation
  function getPrice() public view override returns (uint256 anchorPrice, uint256 minPrice, uint256 maxPrice) {
    (anchorPrice, minPrice, maxPrice) = _getBTCUSDSpotPrice();

    uint256 cachedMaxPriceDeviation = maxPriceDeviation; // gas saving
    // use anchor price when the price deviation between anchor price and min price exceed threshold
    if ((anchorPrice - minPrice) * PRECISION > cachedMaxPriceDeviation * minPrice) {
      minPrice = anchorPrice;
    }

    // use anchor price when the price deviation between anchor price and max price exceed threshold
    if ((maxPrice - anchorPrice) * PRECISION > cachedMaxPriceDeviation * anchorPrice) {
      maxPrice = anchorPrice;
    }
  }

  /// @inheritdoc IPriceOracle
  function getExchangePrice() public view returns (uint256) {
    (, uint256 price, ) = getPrice();
    return price;
  }

  /// @inheritdoc IPriceOracle
  function getLiquidatePrice() external view returns (uint256) {
    return getExchangePrice();
  }

  /// @inheritdoc IPriceOracle
  function getRedeemPrice() external view returns (uint256) {
    (, , uint256 price) = getPrice();
    return price;
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Update the on-chain spot encodings.
  /// @param encodings The encodings to update. See `_getSpotPriceByEncoding` for more details.
  function updateOnchainSpotEncodings(bytes memory encodings) external onlyOwner {
    // validate encoding
    _getSpotPriceByEncoding(encodings);

    onchainSpotEncodings_cbBTCUSD = encodings;
  }

  /// @notice Update the value of maximum price deviation.
  /// @param newMaxPriceDeviation The new value of maximum price deviation, multiplied by 1e18.
  function updateMaxPriceDeviation(uint256 newMaxPriceDeviation) external onlyOwner {
    _updateMaxPriceDeviation(newMaxPriceDeviation);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to update the value of maximum price deviation.
  /// @param newMaxPriceDeviation The new value of maximum price deviation, multiplied by 1e18.
  function _updateMaxPriceDeviation(uint256 newMaxPriceDeviation) private {
    uint256 oldMaxPriceDeviation = maxPriceDeviation;
    if (oldMaxPriceDeviation == newMaxPriceDeviation) {
      revert ErrorParameterUnchanged();
    }

    maxPriceDeviation = newMaxPriceDeviation;

    emit UpdateMaxPriceDeviation(oldMaxPriceDeviation, newMaxPriceDeviation);
  }

  /// @dev Internal function to calculate the cbBTC/USD spot price.
  /// @return chainlinkPrice The spot price from Chainlink price feed, multiplied by 1e18.
  /// @return minPrice The minimum spot price among all available sources, multiplied by 1e18.
  /// @return maxPrice The maximum spot price among all available sources, multiplied by 1e18.
  function _getBTCUSDSpotPrice() internal view returns (uint256 chainlinkPrice, uint256 minPrice, uint256 maxPrice) {
    chainlinkPrice = _readSpotPriceByChainlink(Chainlink_BTC_USD_Spot);
    uint256[] memory prices = _getSpotPriceByEncoding(onchainSpotEncodings_cbBTCUSD);
    minPrice = maxPrice = chainlinkPrice;
    for (uint256 i = 0; i < prices.length; i++) {
      if (prices[i] > maxPrice) maxPrice = prices[i];
      if (prices[i] < minPrice) minPrice = prices[i];
    }
  }
}
