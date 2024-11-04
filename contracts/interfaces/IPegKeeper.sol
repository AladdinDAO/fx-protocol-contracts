// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IPegKeeper {
  function isBorrowAllowed() external view returns (bool);

  function isFundingEnabled() external view returns (bool);

  function buyback(
    uint256 amountIn,
    bytes calldata data
  ) external returns (uint256 amountOut, uint256 bonus);

  function stabilize(
    address srcToken,
    uint256 amountIn,
    bytes calldata data
  ) external returns (uint256 amountOut, uint256 bonus);

  function onSwap(
    address srcToken,
    address targetToken,
    uint256 amount,
    bytes calldata data
  ) external returns (uint256);
}
