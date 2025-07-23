// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IPoolManager {
  /**********
   * Events *
   **********/

  /// @notice Register a new pool.
  /// @param pool The address of fx pool.
  event RegisterPool(address indexed pool);

  /// @notice Emitted when the reward splitter contract is updated.
  /// @param pool The address of fx pool.
  /// @param oldSplitter The address of previous reward splitter contract.
  /// @param newSplitter The address of current reward splitter contract.
  event UpdateRewardSplitter(address indexed pool, address indexed oldSplitter, address indexed newSplitter);

  /// @notice Emitted when token rate is updated.
  /// @param scalar The token scalar to reach 18 decimals.
  /// @param provider The address of token rate provider.
  event UpdateTokenRate(address indexed token, uint256 scalar, address provider);

  /// @notice Emitted when pool capacity is updated.
  /// @param pool The address of fx pool.
  /// @param collateralCapacity The capacity for collateral token.
  /// @param debtCapacity The capacity for debt token.
  event UpdatePoolCapacity(address indexed pool, uint256 collateralCapacity, uint256 debtCapacity);

  /// @notice Emitted when position is updated.
  /// @param pool The address of pool where the position belongs to.
  /// @param position The id of the position.
  /// @param deltaColls The amount of collateral token changes.
  /// @param deltaDebts The amount of debt token changes.
  /// @param protocolFees The amount of protocol fees charges.
  event Operate(
    address indexed pool,
    uint256 indexed position,
    int256 deltaColls,
    int256 deltaDebts,
    uint256 protocolFees
  );

  /// @notice Emitted when redeem happened.
  /// @param pool The address of pool redeemed.
  /// @param colls The amount of collateral tokens redeemed.
  /// @param debts The amount of debt tokens redeemed.
  /// @param protocolFees The amount of protocol fees charges.
  event Redeem(address indexed pool, uint256 colls, uint256 debts, uint256 protocolFees);

  /// @notice Emitted when someone harvest pending rewards.
  /// @param caller The address of caller.
  /// @param amountRewards The amount of total harvested rewards.
  /// @param amountFunding The amount of total harvested funding.
  /// @param performanceFee The amount of harvested rewards distributed to protocol revenue.
  /// @param harvestBounty The amount of harvested rewards distributed to caller as harvest bounty.
  event Harvest(
    address indexed caller,
    address indexed pool,
    uint256 amountRewards,
    uint256 amountFunding,
    uint256 performanceFee,
    uint256 harvestBounty
  );

  /// @notice Emitted when debt is reduced by someone.
  /// @param pool The address of pool reduced.
  /// @param amount The amount of debt token reduced.
  event ReduceDebt(address indexed pool, uint256 amount);

  /*************************
   * Public View Functions *
   *************************/

  /// @notice The address of fxUSD.
  function fxUSD() external view returns (address);

  /// @notice The address of counterparty PoolManager.
  function counterparty() external view returns (address);

  /// @notice The address of `PoolConfiguration` contract.
  function configuration() external view returns (address);

  /// @notice The address of reward splitter.
  function rewardSplitter(address pool) external view returns (address);

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Open a new position or operate on an old position.
  /// @param pool The address of pool to operate.
  /// @param positionId The id of the position. If `positionId=0`, it means we need to open a new position.
  /// @param newColl The amount of collateral token to supply (positive value) or withdraw (negative value).
  /// @param newDebt The amount of debt token to borrow (positive value) or repay (negative value).
  /// @return actualPositionId The id of this position.
  function operate(
    address pool,
    uint256 positionId,
    int256 newColl,
    int256 newDebt
  ) external returns (uint256 actualPositionId);

  /// @notice Redeem debt tokens to get collateral tokens.
  /// @param pool The address of pool to redeem.
  /// @param debts The amount of debt tokens to redeem.
  /// @param minColls The minimum amount of collateral tokens should redeem.
  /// @return actualDebts The actual amount of debt tokens used.
  /// @return colls The amount of collateral tokens redeemed.
  function redeem(address pool, uint256 debts, uint256 minColls) external returns (uint256 actualDebts, uint256 colls);

  /// @notice Harvest pending rewards of the given pool.
  /// @param pool The address of pool to harvest.
  /// @return amountRewards The amount of rewards harvested.
  /// @return amountFunding The amount of funding harvested.
  function harvest(address pool) external returns (uint256 amountRewards, uint256 amountFunding);

  /// @notice Reduce the debt of a pool. This function is only callable by whitelisted addresses.
  /// @param pool The address of the pool to reduce debt for.
  /// @param amount The amount of debt token to reduce.
  function reduceDebt(address pool, uint256 amount) external;
}
