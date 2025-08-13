// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

interface IPoolConfiguration {
  /**********
   * Events *
   **********/

  /// @notice Emitted when the oracle is updated.
  /// @param oldOracle The old oracle address.
  /// @param newOracle The new oracle address.
  event UpdateOracle(address indexed oldOracle, address indexed newOracle);

  /// @notice Emitted when the pool fee ratio is updated.
  /// @param pool The address of pool.
  /// @param recipient The address of recipient.
  /// @param supplyRatio The supply ratio, multiplied by 1e9.
  /// @param supplyRatioStep The supply ratio step, multiplied by 1e18.
  /// @param withdrawFeeRatio The withdraw fee ratio, multiplied by 1e9.
  /// @param borrowFeeRatio The borrow fee ratio, multiplied by 1e9.
  /// @param repayFeeRatio The repay fee ratio, multiplied by 1e9.
  event UpdatePoolFeeRatio(
    address indexed pool,
    address indexed recipient,
    uint256 supplyRatio,
    uint256 supplyRatioStep,
    uint256 withdrawFeeRatio,
    uint256 borrowFeeRatio,
    uint256 repayFeeRatio
  );

  /// @notice Emitted when the long funding ratio parameter is updated.
  /// @param scalarA The scalar A.
  /// @param scalarB The scalar B.
  /// @param maxFxUSDRatio The max fxUSD ratio.
  event UpdateLongFundingRatioParameter(uint64 scalarA, uint64 scalarB, uint64 maxFxUSDRatio);

  /// @notice Emitted when the short funding ratio parameter is updated.
  /// @param scalarC The scalar C.
  /// @param maxBorrowRatio The max borrow ratio.
  event UpdateShortFundingRatioParameter(uint64 scalarC, uint64 maxBorrowRatio);

  /// @notice Emitted when the snapshot is taken.
  /// @param borrowIndex The borrow index.
  /// @param lastInterestRate The last interest rate.
  /// @param timestamp The timestamp of the snapshot.
  event Snapshot(uint256 borrowIndex, uint256 lastInterestRate, uint256 timestamp);

  /// @notice Emitted when the stable depeg price is updated.
  /// @param oldStableDepegPrice The old stable depeg price.
  /// @param newStableDepegPrice The new stable depeg price.
  event UpdateStableDepegPrice(uint256 oldStableDepegPrice, uint256 newStableDepegPrice);

  /// @notice Emitted when an address is registered.
  /// @param key The key of the registered address.
  /// @param addr The registered address.
  event Register(bytes32 key, address addr);

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Return whether borrow for fxUSD is allowed.
  function isBorrowAllowed() external view returns (bool);

  /// @notice Return whether redeem for fxUSD is allowed.
  function isRedeemAllowed() external view returns (bool);

  /// @notice Return whether funding costs is enabled.
  function isFundingEnabled() external view returns (bool);

  /// @notice Return whether repay with stable coin is allowed.
  function isStableRepayAllowed() external view returns (bool);

  /// @notice Get the pool fee ratio.
  /// @param pool The address of pool.
  /// @param recipient The address of recipient.
  /// @return supplyFeeRatio The supply fee ratio, multiplied by 1e9.
  /// @return withdrawFeeRatio The withdraw fee ratio, multiplied by 1e9.
  /// @return borrowFeeRatio The borrow fee ratio, multiplied by 1e9.
  /// @return repayFeeRatio The repay fee ratio, multiplied by 1e9.
  function getPoolFeeRatio(
    address pool,
    address recipient
  )
    external
    view
    returns (uint256 supplyFeeRatio, uint256 withdrawFeeRatio, uint256 borrowFeeRatio, uint256 repayFeeRatio);

  /// @notice Get the long pool funding ratio.
  /// @param pool The address of pool.
  /// @return fundingRatio The funding ratio, multiplied by 1e18.
  function getLongPoolFundingRatio(address pool) external view returns (uint256 fundingRatio);

  /// @notice Get the short pool funding ratio.
  /// @param pool The address of pool.
  /// @return fundingRatio The funding ratio, multiplied by 1e18.
  function getShortPoolFundingRatio(address pool) external view returns (uint256 fundingRatio);

  /// @notice Get the registered address.
  /// @param key The key of the registered address.
  /// @return address The registered address.
  function registry(bytes32 key) external view returns (address);

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Checkpoint the lending pool snapshot.
  /// @param pool The address of pool.
  function checkpoint(address pool) external;

  /// @notice Lock the pool manager.
  /// @param manager The address of pool manager.
  /// @param selector The selector of the function to lock.
  function lock(address manager, bytes4 selector) external;
}
