// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IPoolManager } from "./IPoolManager.sol";

interface ILongPoolManager is IPoolManager {
  /**********
   * Events *
   **********/

  /// @notice Emitted when the threshold for permissionless liquidate/rebalance is updated.
  /// @param oldThreshold The value of previous threshold.
  /// @param newThreshold The value of current threshold.
  event UpdatePermissionedLiquidationThreshold(uint256 oldThreshold, uint256 newThreshold);

  /// @notice Emitted when rebalance for a tick happened.
  /// @param pool The address of pool rebalanced.
  /// @param tick The index of tick rebalanced.
  /// @param colls The amount of collateral tokens rebalanced.
  /// @param fxUSDDebts The amount of fxUSD rebalanced.
  /// @param stableDebts The amount of stable token (a.k.a USDC) rebalanced.
  event RebalanceTick(address indexed pool, int16 indexed tick, uint256 colls, uint256 fxUSDDebts, uint256 stableDebts);

  /// @notice Emitted when rebalance happened.
  /// @param pool The address of pool rebalanced.
  /// @param colls The amount of collateral tokens rebalanced.
  /// @param fxUSDDebts The amount of fxUSD rebalanced.
  /// @param stableDebts The amount of stable token (a.k.a USDC) rebalanced.
  event Rebalance(address indexed pool, uint256 colls, uint256 fxUSDDebts, uint256 stableDebts);

  /// @notice Emitted when liquidate happened.
  /// @param pool The address of pool liquidated.
  /// @param colls The amount of collateral tokens liquidated.
  /// @param fxUSDDebts The amount of fxUSD liquidated.
  /// @param stableDebts The amount of stable token (a.k.a USDC) liquidated.
  event Liquidate(address indexed pool, uint256 colls, uint256 fxUSDDebts, uint256 stableDebts);

  /// @notice Emitted when the short borrow capacity ratio for the given long pool is updated.
  /// @param longPool The address of the long pool.
  /// @param oldRatio The old short borrow capacity ratio.
  /// @param newRatio The new short borrow capacity ratio.
  event UpdateShortBorrowCapacityRatio(address indexed longPool, uint256 oldRatio, uint256 newRatio);

  /*************************
   * Public View Functions *
   *************************/

  /// @notice The address of FxUSDSave.
  function fxBASE() external view returns (address);

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Open a new position or operate on an old position.
  /// @param pool The address of pool to operate.
  /// @param positionId The id of the position. If `positionId=0`, it means we need to open a new position.
  /// @param newColl The amount of collateral token to supply (positive value) or withdraw (negative value).
  /// @param newDebt The amount of debt token to borrow (positive value) or repay (negative value).
  /// @param useStable Whether to use stable token for repay.
  /// @return actualPositionId The id of this position.
  function operate(
    address pool,
    uint256 positionId,
    int256 newColl,
    int256 newDebt,
    bool useStable
  ) external returns (uint256 actualPositionId);

  /// @notice Rebalance all positions in the given tick.
  /// @param pool The address of pool to rebalance.
  /// @param receiver The address of recipient for rebalanced tokens.
  /// @param tick The index of tick to rebalance.
  /// @param maxFxUSD The maximum amount of fxUSD to rebalance.
  /// @param maxStable The maximum amount of stable token (a.k.a USDC) to rebalance.
  /// @return colls The amount of collateral tokens rebalanced.
  /// @return fxUSDUsed The amount of fxUSD used to rebalance.
  /// @return stableUsed The amount of stable token used to rebalance.
  function rebalance(
    address pool,
    address receiver,
    int16 tick,
    uint256 maxFxUSD,
    uint256 maxStable
  ) external returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed);

  /// @notice Rebalance all positions in the given tick.
  /// @param pool The address of pool to rebalance.
  /// @param receiver The address of recipient for rebalanced tokens.
  /// @param maxFxUSD The maximum amount of fxUSD to rebalance.
  /// @param maxStable The maximum amount of stable token (a.k.a USDC) to rebalance.
  /// @return colls The amount of collateral tokens rebalanced.
  /// @return fxUSDUsed The amount of fxUSD used to rebalance.
  /// @return stableUsed The amount of stable token used to rebalance.
  function rebalance(
    address pool,
    address receiver,
    uint256 maxFxUSD,
    uint256 maxStable
  ) external returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed);

  /// @notice Liquidate a given position.
  /// @param pool The address of pool to liquidate.
  /// @param receiver The address of recipient for liquidated tokens.
  /// @param maxFxUSD The maximum amount of fxUSD to liquidate.
  /// @param maxStable The maximum amount of stable token (a.k.a USDC) to liquidate.
  /// @return colls The amount of collateral tokens liquidated.
  /// @return fxUSDUsed The amount of fxUSD used to liquidate.
  /// @return stableUsed The amount of stable token used to liquidate.
  function liquidate(
    address pool,
    address receiver,
    uint256 maxFxUSD,
    uint256 maxStable
  ) external returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed);

  /// @notice Borrow collateral token from long pool.
  /// @param longPool The address of long pool.
  /// @param shortPool The address of short pool.
  /// @param amount The amount of collateral token to borrow.
  function borrow(address longPool, address shortPool, uint256 amount) external;

  /// @notice Repay collateral token to long pool.
  /// @param longPool The address of long pool.
  /// @param shortPool The address of short pool.
  /// @param amount The amount of collateral token to repay.
  function repay(address longPool, address shortPool, uint256 amount) external;

  /// @notice Repay collateral token to long pool by credit note.
  /// @param longPool The address of long pool.
  /// @param shortPool The address of short pool.
  /// @param amount The amount of credit note token to repay.
  function repayByCreditNote(address longPool, address shortPool, uint256 amount) external;

  /// @notice Liquidate short pool.
  /// @param longPool The address of long pool.
  /// @param shortPool The address of short pool.
  /// @param amountFxUSD The amount of fxUSD to liquidate.
  /// @param totalBorrowed The total amount of collateral tokens borrowed from long pool.
  /// @return shortfall The amount of shortfall collateral token.
  function liquidateShortPool(
    address longPool,
    address shortPool,
    uint256 amountFxUSD,
    uint256 totalBorrowed
  ) external returns (uint256 shortfall);
}
