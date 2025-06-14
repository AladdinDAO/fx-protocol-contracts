// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IStakedToken is IERC20Metadata {
  /**********
   * Events *
   **********/

  /// @notice Emitted when bFXN is staked to xbFXN.
  /// @param owner The address of bFXN owner.
  /// @param receiver The address of xbFXN receiver.
  /// @param amount The amount of bFXN staked.
  event Stake(address indexed owner, address indexed receiver, uint256 amount);

  /// @notice Emitted when xbFXN is exited as bFXN.
  /// @param owner The address of xbFXN owner.
  /// @param receiver The address of bFXN receiver.
  /// @param amount The amount of xbFXN exited, including penalty.
  /// @param penalty The amount of bFXN as penalty.
  event Exit(address indexed owner, address indexed receiver, uint256 amount, uint256 penalty);

  /// @notice Emitted when xbFXN is vested as bFXN.
  /// @param owner The address of xbFXN owner.
  /// @param id The index of the vesting.
  /// @param duration The duration of this vesting.
  /// @param amount The amount of xbFXN vested, including penalty.
  /// @param penalty The amount of bFXN as penalty.
  event Vest(address indexed owner, uint256 id, uint256 duration, uint256 amount, uint256 penalty);

  /// @notice Emitted when a vesting is cancelled.
  /// @param owner The address of xbFXN owner.
  /// @param id The index of the vesting.
  event CancelVest(address indexed owner, uint256 id);

  /// @notice Emitted when a vesting is claimed.
  /// @param owner The address of xbFXN owner.
  /// @param id The index of the vesting.
  /// @param amount The amount of xbFXN vested, including penalty.
  /// @param penalty The amount of bFXN as penalty.
  event ClaimVest(address indexed owner, uint256 id, uint256 amount, uint256 penalty);

  /// @notice Emitted when penalty is distributed.
  /// @param day The day timestamp to distribute.
  /// @param penalty The amount of penalty at that day.
  event DistributeExitPenalty(uint256 day, uint256 penalty);

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Return the number of vesting of the given user.
  function getVestingLength(address user) external view returns (uint256);

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Stake bFXN as xbFXN.
  /// @param amount The amount of bFXN to stake.
  /// @param receiver The address of xbFXN receiver.
  function stake(uint256 amount, address receiver) external;

  /// @notice Exit xbFXN as bFXN.
  /// @param amount The amount of xbFXN to exit.
  /// @param receiver The address of bFXN receiver.
  /// @return exited The amount of bFXN received.
  function exit(uint256 amount, address receiver) external returns (uint256 exited);

  /// @notice Create a xbFXN vesting.
  /// @param amount The amount of xbFXN to vest.
  /// @param duration The duration in seconds of the vesting.
  /// @return id The index of the vesting.
  function createVest(uint112 amount, uint256 duration) external returns (uint256 id);

  /// @notice Cancel an existing xbFXN vesting.
  /// @param id The index of the vesting.
  function cancelVest(uint256 id) external;

  /// @notice Claim an existing xbFXN vesting.
  /// @param id The index of the vesting.
  function claimVest(uint256 id) external;

  /// @notice Claim a list of existing xbFXN vestings.
  /// @param ids The list of indices of the vesting.
  function claimVests(uint256[] memory ids) external;

  /// @notice Distribute bFXN penalty.
  function distributeExitPenalty() external;
}
