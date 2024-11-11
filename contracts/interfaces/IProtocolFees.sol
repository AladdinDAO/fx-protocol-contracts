// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IProtocolFees {
  /**********
   * Events *
   **********/

  /// @notice Emitted when the reserve pool contract is updated.
  /// @param oldReservePool The address of previous reserve pool.
  /// @param newReservePool The address of current reserve pool.
  event UpdateReservePool(address indexed oldReservePool, address indexed newReservePool);

  /// @notice Emitted when the platform contract is updated.
  /// @param oldPlatform The address of previous platform contract.
  /// @param newPlatform The address of current platform contract.
  event UpdatePlatform(address indexed oldPlatform, address indexed newPlatform);

  /// @notice Emitted when the ratio for treasury is updated.
  /// @param oldRatio The value of the previous ratio, multiplied by 1e9.
  /// @param newRatio The value of the current ratio, multiplied by 1e9.
  event UpdateExpenseRatio(uint256 oldRatio, uint256 newRatio);

  /// @notice Emitted when the ratio for harvester is updated.
  /// @param oldRatio The value of the previous ratio, multiplied by 1e9.
  /// @param newRatio The value of the current ratio, multiplied by 1e9.
  event UpdateHarvesterRatio(uint256 oldRatio, uint256 newRatio);

  /// @notice Emitted when the flash loan fee ratio is updated.
  /// @param oldRatio The value of the previous ratio, multiplied by 1e9.
  /// @param newRatio The value of the current ratio, multiplied by 1e9.
  event UpdateFlashLoanFeeRatio(uint256 oldRatio, uint256 newRatio);

  /// @notice Emitted when the redeem fee ratio is updated.
  /// @param oldRatio The value of the previous ratio, multiplied by 1e9.
  /// @param newRatio The value of the current ratio, multiplied by 1e9.
  event UpdateRedeemFeeRatio(uint256 oldRatio, uint256 newRatio);

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Return the fee ratio distributed as protocol revenue, multiplied by 1e9.
  function getExpenseRatio() external view returns (uint256);

  /// @notice Return the fee ratio distributed ad harvester bounty, multiplied by 1e9.
  function getHarvesterRatio() external view returns (uint256);

  /// @notice Return the fee ratio distributed to rebalance pool, multiplied by 1e9.
  function getRebalancePoolRatio() external view returns (uint256);

  /// @notice Return the flash loan fee ratio, multiplied by 1e9.
  function getFlashLoanFeeRatio() external view returns (uint256);

  /// @notice Return the redeem fee ratio, multiplied by 1e9.
  function getRedeemFeeRatio() external view returns (uint256);

  /// @notice Return the address of reserve pool.
  function reservePool() external view returns (address);

  /// @notice Return the address of platform.
  function platform() external view returns (address);

  /// @notice Return the amount of protocol fees accumulated by the given pool.
  function accumulatedPoolFees(address pool) external view returns (uint256);

  /// @notice Withdraw accumulated pool fee for the given pool lists.
  /// @param pools The list of pool addresses to withdraw.
  function withdrawAccumulatedPoolFee(address[] memory pools) external;
}
