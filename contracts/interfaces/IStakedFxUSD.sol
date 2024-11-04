// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IStakedFxUSD {
  event Deposit(
    address indexed caller,
    address indexed receiver,
    address indexed tokenIn,
    uint256 amountDeposited,
    uint256 amountSyOut
  );

  event Redeem(
    address indexed caller,
    address indexed receiver,
    uint256 amountSyToRedeem,
    uint256 amountYieldTokenOut,
    uint256 amountStableTokenOut
  );

  function yieldToken() external view returns (address);

  function stableToken() external view returns (address);

  /// @notice The total amount of yield token managed in this contract
  function totalYieldToken() external view returns (uint256);

  /// @notice The total amount of stable token managed in this contract
  function totalStableToken() external view returns (uint256);

  function nav() external view returns (uint256);

  function getStableTokenPrice() external view returns (uint256);

  function getStableTokenPriceWithScale() external view returns (uint256);

  function previewDeposit(address tokenIn, uint256 amount) external view returns (uint256 amountSharesOut);

  function previewRedeem(
    uint256 amountSharesToRedeem
  ) external view returns (uint256 amountYieldOut, uint256 amountStableOut);

  function deposit(
    address receiver,
    address tokenIn,
    uint256 amountTokenToDeposit,
    uint256 minSharesOut
  ) external returns (uint256 amountSharesOut);

  function redeem(address receiver, uint256 shares) external returns (uint256 amountYieldOut, uint256 amountStableOut);

  function rebalance(
    address pool,
    int16 tickId,
    address tokenIn,
    uint256 maxAmount,
    uint256 minBaseOut
  ) external returns (uint256 tokenUsed, uint256 baseOut);

  function rebalance(
    address pool,
    uint32 positionId,
    address tokenIn,
    uint256 maxAmount,
    uint256 minBaseOut
  ) external returns (uint256 tokenUsed, uint256 baseOut);

  function liquidate(
    address pool,
    uint32 positionId,
    address tokenIn,
    uint256 maxAmount,
    uint256 minBaseOut
  ) external returns (uint256 tokenUsed, uint256 baseOut);

  function arbitrage(
    address srcToken,
    uint256 amount,
    address receiver,
    bytes calldata data
  ) external returns (uint256 amountOut, uint256 bonusOut);
}
