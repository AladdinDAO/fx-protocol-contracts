// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IFxUSDRegeneracy {
  function mint(address to, uint256 amount) external;

  function burn(address from, uint256 amount) external;

  function onRebalanceWithStable(uint256 amountStableToken, uint256 amountFxUSD) external;

  function buyback(uint256 amountIn, address receiver, bytes calldata data) external returns (uint256 amountOut, uint256 bonusOut);
}
