// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IPriceOracle {
  function getPrice() external view returns (uint256 anchorPrice, uint256 minPrice, uint256 maxPrice);
}
