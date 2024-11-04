// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IPoolManager {
  /**********
   * Events *
   **********/

  /// @notice Emitted when the reward splitter contract is updated.
  /// @param pool The address of fx pool.
  /// @param oldSplitter The address of previous reward splitter contract.
  /// @param newSplitter The address of current reward splitter contract.
  event UpdateRewardSplitter(address indexed pool, address indexed oldSplitter, address indexed newSplitter);

  /// @notice Emitted when someone harvest pending rewards.
  /// @param caller The address of caller.
  /// @param amountRewards The amount of total harvested rewards.
  /// @param performanceFee The amount of harvested rewards distributed to protocol revenue.
  /// @param harvestBounty The amount of harvested rewards distributed to caller as harvest bounty.
  event Harvest(
    address indexed caller,
    address indexed pool,
    uint256 amountRewards,
    uint256 performanceFee,
    uint256 harvestBounty
  );

  /*************************
   * Public View Functions *
   *************************/

  function fxUSD() external view returns (address);

  function sfxUSD() external view returns (address);

  function pegKeeper() external view returns (address);

  /// @notice The address of reward splitter.
  function rewardSplitter(address pool) external view returns (address);

  /****************************
   * Public Mutated Functions *
   ****************************/

  function operate(
    address pool,
    uint256 positionId,
    int256 newRawColl,
    int256 newRawDebt
  ) external returns (uint256 actualPositionId);

  function rebalance(
    address pool,
    address receiver,
    int16 tickId,
    uint256 maxFxUSD,
    uint256 maxStable
  ) external returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed);

  function rebalance(
    address pool,
    address receiver,
    uint32 positionId,
    uint256 maxFxUSD,
    uint256 maxStable
  ) external returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed);

  function liquidate(
    address pool,
    address receiver,
    uint32 positionId,
    uint256 maxFxUSD,
    uint256 maxStable
  ) external returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed);
}
