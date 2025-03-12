// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IGauge {
  /**********
   * Events *
   **********/

  /// @notice Emitted when user deposit staking token to this contract.
  /// @param owner The address of token owner.
  /// @param receiver The address of recipient for the pool share.
  /// @param amount The amount of staking token deposited.
  event Deposit(address indexed owner, address indexed receiver, uint256 amount);

  /// @notice Emitted when user withdraw staking token from this contract.
  /// @param owner The address of token owner.
  /// @param receiver The address of recipient for the staking token
  /// @param amount The amount of staking token withdrawn.
  event Withdraw(address indexed owner, address indexed receiver, uint256 amount);

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Return the address of staking token.
  function stakingToken() external view returns (address);

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Deposit some staking token to this contract.
  ///
  /// @dev Use `amount = type(uint256).max`, if caller wants to deposit all held staking tokens.
  ///
  /// @param amount The amount of staking token to deposit.
  function deposit(uint256 amount) external;

  /// @notice Deposit some staking token to this contract and transfer the share to others.
  ///
  /// @dev Use `amount = type(uint256).max`, if caller wants to deposit all held staking tokens.
  ///
  /// @param amount The amount of staking token to deposit.
  /// @param receiver The address of the pool share recipient.
  function deposit(uint256 amount, address receiver) external;

  /// @notice Withdraw some staking token from this contract.
  ///
  /// @dev Use `amount = type(uint256).max`, if caller wants to deposit all held staking tokens.
  ///
  /// @param amount The amount of staking token to withdraw.
  function withdraw(uint256 amount) external;

  /// @notice Withdraw some staking token from this contract and transfer the token to others.
  ///
  /// @dev Use `amount = type(uint256).max`, if caller wants to deposit all held staking tokens.
  ///
  /// @param amount The amount of staking token to withdraw.
  /// @param receiver The address of the staking token recipient.
  function withdraw(uint256 amount, address receiver) external;
}
