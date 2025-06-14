// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { AggregatorV3Interface } from "../interfaces/Chainlink/AggregatorV3Interface.sol";

import { IRateProvider } from "./interfaces/IRateProvider.sol";

// solhint-disable contract-name-camelcase

contract ChainlinkRateProvider is IRateProvider {
  /// @notice The Chainlink price feed.
  /// @dev See comments of `_readSpotPriceByChainlink` for more details.
  bytes32 public immutable ChainlinkPriceFeed;

  constructor(bytes32 _ChainlinkPriceFeed) {
    ChainlinkPriceFeed = _ChainlinkPriceFeed;
  }

  /// @inheritdoc IRateProvider
  function getRate() external view override returns (uint256) {
    return _readSpotPriceByChainlink(ChainlinkPriceFeed);
  }

  /// @dev The encoding is below.
  /// ```text
  /// |  32 bits  | 64 bits |  160 bits  |
  /// | heartbeat |  scale  | price_feed |
  /// |low                          high |
  /// ```
  function _readSpotPriceByChainlink(bytes32 encoding) internal view returns (uint256) {
    address aggregator;
    uint256 scale;
    uint256 heartbeat;
    assembly {
      aggregator := shr(96, encoding)
      scale := and(shr(32, encoding), 0xffffffffffffffff)
      heartbeat := and(encoding, 0xffffffff)
    }
    (, int256 answer, , uint256 updatedAt, ) = AggregatorV3Interface(aggregator).latestRoundData();
    if (answer <= 0) revert("invalid");
    if (block.timestamp - updatedAt > heartbeat) revert("expired");
    return uint256(answer) * scale;
  }
}
