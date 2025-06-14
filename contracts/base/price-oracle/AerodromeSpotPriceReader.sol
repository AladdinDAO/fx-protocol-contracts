// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IAerodromeCLPool } from "../../interfaces/Aerodrome/IAerodromeCLPool.sol";
import { ISpotPriceOracle } from "../../price-oracle/interfaces/ISpotPriceOracle.sol";

contract AerodromeSpotPriceReader is ISpotPriceOracle {
  /*************
   * Constants *
   *************/

  /// @dev The precision for spot price.
  uint256 private constant PRECISION = 1e18;

  /// @dev The value of sqrt(PRECISION).
  uint256 private constant HALF_PRECISION = 1e9;

  /// @dev The value of `2^96`.
  uint256 private constant E96 = 2 ** 96;

  /*************************
   * Public View Functions *
   *************************/

  /// @param encoding The encoding of the price source.
  /// @return spotPrice The spot price with 18 decimal places.
  function getSpotPrice(uint256 encoding) external view returns (uint256 spotPrice) {
    uint256 poolType = encoding & 0xff;
    if (poolType != 12) {
      revert("Invalid pool type");
    }

    encoding >>= 8;
    spotPrice = _getSpotPriceByAerodromeCL(encoding);
  }

  function _getSpotPriceByAerodromeCL(uint256 encoding) internal view returns (uint256 spotPrice) {
    address pool = _getPool(encoding);
    uint256 base_index = (encoding >> 160) & 1;
    (uint256 sqrtPriceX96, , , , , ) = IAerodromeCLPool(pool).slot0();
    if (base_index == 1) {
      sqrtPriceX96 = (E96 * E96) / sqrtPriceX96;
    }
    uint256 base_scale = 10 ** ((encoding >> 161) & 255);
    uint256 quote_scale = 10 ** ((encoding >> 169) & 255);
    // sqrt(base/quote) = sqrtPriceX96 / 2^96
    // (base * quote_scale * 10^18) / (quote * base_scale) = (sqrtPriceX96 / 2^96) ^ 2 * quote_scale / base_scale * 10^18
    // sqrtPriceX96^2 * 10^18 * quote_scale / (2^192 * base_scale)
    // (sqrtPriceX96 * 10^9 / 2^96)^2 * quote_scale / base_scale
    if (quote_scale > base_scale) {
      uint256 scale = Math.sqrt(quote_scale / base_scale);
      uint256 price = (sqrtPriceX96 * HALF_PRECISION * scale) / E96;
      return price * price;
    } else {
      uint256 price = (sqrtPriceX96 * HALF_PRECISION) / E96;
      return (price * price * quote_scale) / base_scale;
    }
  }

  /// @dev Internal function to get the address of pool.
  /// @param encoding The route encoding.
  function _getPool(uint256 encoding) internal pure returns (address) {
    return address(uint160(encoding & 1461501637330902918203684832716283019655932542975));
  }
}
