// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IPriceOracle } from "./interfaces/IPriceOracle.sol";
import { IRateProvider } from "../rate-provider/interfaces/IRateProvider.sol";

contract InverseWstETHPriceOracle is IPriceOracle {
  /// @dev The precision of the rate provider.
  uint256 public constant RATE_PRECISION = 1e18;

  /// @notice The address of the `StETHPriceOracle` contract.
  address public immutable oracle;

  address public immutable rateProvider;

  constructor(address _oracle, address _rateProvider) {
    oracle = _oracle;
    rateProvider = _rateProvider;
  }

  /// @inheritdoc IPriceOracle
  function getPrice() public view returns (uint256 anchorPrice, uint256 minPrice, uint256 maxPrice) {
    (uint256 tmpAnchorPrice, uint256 tmpMinPrice, uint256 tmpMaxPrice) = IPriceOracle(oracle).getPrice();
    uint256 rate = IRateProvider(rateProvider).getRate();
    tmpAnchorPrice = (tmpAnchorPrice * rate) / RATE_PRECISION;
    tmpMinPrice = (tmpMinPrice * rate) / RATE_PRECISION;
    tmpMaxPrice = (tmpMaxPrice * rate) / RATE_PRECISION;
    anchorPrice = 1e36 / tmpAnchorPrice;
    minPrice = 1e36 / tmpMaxPrice;
    maxPrice = 1e36 / tmpMinPrice;
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
}
