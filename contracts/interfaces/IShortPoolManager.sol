// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IPoolManager } from "./IPoolManager.sol";

interface IShortPoolManager is IPoolManager {
  /**********
   * Events *
   **********/

  /// @notice Emitted when rebalance for a tick happened.
  /// @param pool The address of pool rebalanced.
  /// @param tick The index of tick rebalanced.
  /// @param colls The amount of collateral tokens rebalanced.
  /// @param debts The amount of debt tokens rebalanced.
  event RebalanceTick(address indexed pool, int16 indexed tick, uint256 colls, uint256 debts);

  /// @notice Emitted when rebalance happened.
  /// @param pool The address of pool rebalanced.
  /// @param colls The amount of collateral tokens rebalanced.
  /// @param debts The amount of debt tokens rebalanced.
  event Rebalance(address indexed pool, uint256 colls, uint256 debts);

  /// @notice Emitted when liquidate happened.
  /// @param pool The address of pool liquidated.
  /// @param colls The amount of collateral tokens liquidated.
  /// @param debts The amount of debt tokens liquidated.
  event Liquidate(address indexed pool, uint256 colls, uint256 debts);

  /// @notice Emitted when redeem by credit note happened.
  /// @param pool The address of pool redeemed.
  /// @param colls The amount of collateral tokens redeemed.
  /// @param debts The amount of debt tokens redeemed.
  /// @param protocolFees The amount of protocol fees charges.
  event RedeemByCreditNote(address indexed pool, uint256 colls, uint256 debts, uint256 protocolFees);

  /// @notice Emitted when pool killed.
  /// @param pool The address of pool killed.
  /// @param rawColls The amount of fxUSD as collateral.
  /// @param rawDebts The amount of raw debt tokens borrowed from long pool.
  /// @param shortfall The amount of shortfall debt token.
  event KillPool(address indexed pool, uint256 rawColls, uint256 rawDebts, uint256 shortfall);

  /*************************
   * Public View Functions *
   *************************/

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Redeem fxUSD by burning credit note tokens.
  /// @param pool The address of the pool to redeem from.
  /// @param rawDebts The amount of credit note tokens to burn.
  /// @param minColls The minimum amount of fxUSD to receive.
  /// @return colls The amount of fxUSD received.
  function redeemByCreditNote(address pool, uint256 rawDebts, uint256 minColls) external returns (uint256 colls);

  /// @notice Rebalance positions in a specific tick of the pool.
  /// @param pool The address of the pool to rebalance.
  /// @param receiver The address that will receive the rebalanced tokens.
  /// @param tick The index of the tick to rebalance.
  /// @param maxRawDebts The maximum amount of raw debt tokens to use for rebalancing.
  /// @return colls The amount of fxUSD rebalanced.
  /// @return debts The amount of debt tokens used for rebalancing.
  function rebalance(
    address pool,
    address receiver,
    int16 tick,
    uint256 maxRawDebts
  ) external returns (uint256 colls, uint256 debts);

  /// @notice Rebalance all positions in the pool.
  /// @param pool The address of the pool to rebalance.
  /// @param receiver The address that will receive the rebalanced tokens.
  /// @param maxRawDebts The maximum amount of raw debt tokens to use for rebalancing.
  /// @return colls The amount of fxUSD rebalanced.
  /// @return debts The amount of debt tokens used for rebalancing.
  function rebalance(address pool, address receiver, uint256 maxRawDebts) external returns (uint256 colls, uint256 debts);

  /// @notice Liquidate positions in the pool.
  /// @param pool The address of the pool to liquidate.
  /// @param receiver The address that will receive the liquidated tokens.
  /// @param maxRawDebts The maximum amount of raw debt tokens to use for liquidation.
  /// @return colls The amount of fxUSD liquidated.
  /// @return debts The amount of debt tokens used for liquidation.
  function liquidate(address pool, address receiver, uint256 maxRawDebts) external returns (uint256 colls, uint256 debts);

  /// @notice Kill the pool.
  /// @param pool The address of the pool to kill.
  function killPool(address pool) external;
}
