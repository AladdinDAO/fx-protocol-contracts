// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { SpotPriceOracleBase } from "../../price-oracle/SpotPriceOracleBase.sol";

import { IPriceOracle } from "../../price-oracle/interfaces/IPriceOracle.sol";
import { ITwapOracle } from "../../price-oracle/interfaces/ITwapOracle.sol";

contract BaseStETHPriceOracle is SpotPriceOracleBase, IPriceOracle {
  /*************
   * Constants *
   *************/

  /// @notice The Chainlink ETH/USD price feed.
  /// @dev See comments of `_readSpotPriceByChainlink` for more details.
  bytes32 public immutable Chainlink_ETH_USD_Spot;

  /// @notice The Chainlink wstETH/USD price feed.
  /// @dev See comments of `_readSpotPriceByChainlink` for more details.
  bytes32 public immutable Chainlink_wstETH_ETH_Spot;

  /// @notice The Chainlink wstETH/stETH price feed.
  /// @dev See comments of `_readSpotPriceByChainlink` for more details.
  bytes32 public immutable Chainlink_wstETH_stETH_Spot;

  /*************
   * Variables *
   *************/

  /// @dev The encodings for ETH/USD spot sources.
  bytes private onchainSpotEncodings_ETH_USD;

  /// @dev The encodings for wstETH/ETH spot sources.
  bytes private onchainSpotEncodings_wstETH_ETH;

  /// @dev The encodings for wstETH/USD spot sources.
  bytes private onchainSpotEncodings_wstETH_USD;

  /// @notice The value of maximum price deviation, multiplied by 1e18.
  uint256 public maxPriceDeviation;

  /***************
   * Constructor *
   ***************/

  constructor(
    address _spotPriceOracle,
    bytes32 _Chainlink_ETH_USD_Spot,
    bytes32 _Chainlink_wstETH_ETH_Spot,
    bytes32 _Chainlink_wstETH_stETH_Spot
  ) SpotPriceOracleBase(_spotPriceOracle) {
    Chainlink_ETH_USD_Spot = _Chainlink_ETH_USD_Spot;
    Chainlink_wstETH_ETH_Spot = _Chainlink_wstETH_ETH_Spot;
    Chainlink_wstETH_stETH_Spot = _Chainlink_wstETH_stETH_Spot;

    _updateMaxPriceDeviation(1e16); // 1%
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Return the wstETH/USD spot price.
  /// @return chainlinkPrice The spot price from Chainlink price feed.
  /// @return minPrice The minimum spot price among all available sources.
  /// @return maxPrice The maximum spot price among all available sources.
  function getWstETHUSDSpotPrice() external view returns (uint256 chainlinkPrice, uint256 minPrice, uint256 maxPrice) {
    (chainlinkPrice, minPrice, maxPrice) = _getWstETHUSDSpotPrice();
  }

  /// @notice Return the wstETH/USD spot prices.
  /// @return prices The list of spot price among all available sources, multiplied by 1e18.
  function getWstETHUSDSpotPrices() external view returns (uint256[] memory prices) {
    prices = _getSpotPriceByEncoding(onchainSpotEncodings_wstETH_USD);
  }

  /// @notice Return the wstETH/ETH spot prices.
  /// @return prices The list of spot price among all available sources, multiplied by 1e18.
  function getWstETHETHSpotPrices() external view returns (uint256[] memory prices) {
    prices = _getSpotPriceByEncoding(onchainSpotEncodings_wstETH_ETH);
  }

  /// @inheritdoc IPriceOracle
  /// @dev The price is valid iff |maxPrice-minPrice|/minPrice < maxPriceDeviation
  function getPrice() public view override returns (uint256 anchorPrice, uint256 minPrice, uint256 maxPrice) {
    (anchorPrice, minPrice, maxPrice) = _getWstETHUSDSpotPrice();

    uint256 chainlinkPrice_wstETH_stETH = _readSpotPriceByChainlink(Chainlink_wstETH_stETH_Spot);
    anchorPrice = (anchorPrice * PRECISION) / chainlinkPrice_wstETH_stETH;
    minPrice = (minPrice * PRECISION) / chainlinkPrice_wstETH_stETH;
    maxPrice = (maxPrice * PRECISION) / chainlinkPrice_wstETH_stETH;

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
  /// @param spotType The type of the encodings.
  function updateOnchainSpotEncodings(bytes memory encodings, uint256 spotType) external onlyOwner {
    // validate encoding
    uint256[] memory prices = _getSpotPriceByEncoding(encodings);

    if (spotType == 0) {
      onchainSpotEncodings_ETH_USD = encodings;
      if (prices.length == 0) revert ErrorInvalidEncodings();
    } else if (spotType == 1) {
      onchainSpotEncodings_wstETH_ETH = encodings;
    } else if (spotType == 2) {
      onchainSpotEncodings_wstETH_USD = encodings;
    }
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
  function _getWstETHUSDSpotPrice() internal view returns (uint256 chainlinkPrice, uint256 minPrice, uint256 maxPrice) {
    // compute chainlink price
    uint256 chainlinkPrice_ETH_USD = _readSpotPriceByChainlink(Chainlink_ETH_USD_Spot);
    uint256 chainlinkPrice_wstETH_ETH = _readSpotPriceByChainlink(Chainlink_wstETH_ETH_Spot);
    chainlinkPrice = (chainlinkPrice_ETH_USD * chainlinkPrice_wstETH_ETH) / PRECISION;

    // consider wstETH/USD
    uint256[] memory prices = _getSpotPriceByEncoding(onchainSpotEncodings_wstETH_USD);
    minPrice = maxPrice = chainlinkPrice;
    for (uint256 i = 0; i < prices.length; i++) {
      if (prices[i] > maxPrice) maxPrice = prices[i];
      if (prices[i] < minPrice) minPrice = prices[i];
    }

    // consider wstETH/ETH * ETH/USD
    uint256 minETHPrice = chainlinkPrice_ETH_USD;
    uint256 maxETHPrice = chainlinkPrice_ETH_USD;
    prices = _getSpotPriceByEncoding(onchainSpotEncodings_ETH_USD);
    for (uint256 i = 0; i < prices.length; i++) {
      if (prices[i] > maxETHPrice) maxETHPrice = prices[i];
      if (prices[i] < minETHPrice) minETHPrice = prices[i];
    }
    prices = _getSpotPriceByEncoding(onchainSpotEncodings_wstETH_ETH);
    for (uint256 i = 0; i < prices.length; i++) {
      uint256 maxPrice_wstETH_USD = maxETHPrice * prices[i];
      uint256 minPrice_wstETH_USD = minETHPrice * prices[i];
      if (maxPrice_wstETH_USD > maxPrice) maxPrice = maxPrice_wstETH_USD;
      if (minPrice_wstETH_USD < minPrice) minPrice = minPrice_wstETH_USD;
    }
  }
}
