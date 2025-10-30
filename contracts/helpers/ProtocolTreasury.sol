// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IHarvesterCallback } from "./interfaces/IHarvesterCallback.sol";

import { PermissionedSwap } from "../common/utils/PermissionedSwap.sol";
import { PegKeeper } from "../core/PegKeeper.sol";

contract ProtocolTreasury is PermissionedSwap {
  using SafeERC20 for IERC20;

  /**********
   * Errors *
   **********/

  /// @dev Thrown when the multicall fails.
  error ErrorMulticallFailed();

  /*************
   * Constants *
   *************/

  /// @notice The role for permissioned multicall.
  bytes32 public constant MULTICALL_ROLE = keccak256("MULTICALL_ROLE");

  /// @notice The role for permissioned batch transfer.
  bytes32 public constant BATCH_TRANSFER_ROLE = keccak256("BATCH_TRANSFER_ROLE");

  /// @notice The role for permissioned token receiver.
  bytes32 public constant TOKEN_RECEIVER_ROLE = keccak256("TOKEN_RECEIVER_ROLE");

  /// @notice The role for permissioned peg keeper.
  bytes32 public constant PEG_KEEPER_ROLE = keccak256("PEG_KEEPER_ROLE");

  /// @notice The role for buyback.
  bytes32 public constant BUYBACK_ROLE = keccak256("BUYBACK_ROLE");

  /// @notice The role for stabilize.
  bytes32 public constant STABILIZE_ROLE = keccak256("STABILIZE_ROLE");

  /***************
   * Constructor *
   ***************/

  function initialize(address _admin) external initializer {
    __Context_init();
    __ERC165_init();
    __AccessControl_init();

    _grantRole(DEFAULT_ADMIN_ROLE, _admin);
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Multicall function to call multiple functions in a single transaction.
  /// @param targets The addresses of the contracts to call.
  /// @param data The data to call the functions with.
  function multicall(address[] calldata targets, bytes[] calldata data) external onlyRole(MULTICALL_ROLE) {
    for (uint256 i = 0; i < targets.length; i++) {
      (bool success, ) = targets[i].call(data[i]);
      if (!success) revert ErrorMulticallFailed();
    }
  }

  /// @notice Batch transfer tokens to the receiver.
  /// @param token The address of the token to transfer.
  /// @param receivers The addresses of the receivers to transfer.
  /// @param amounts The amounts of the tokens to transfer.
  function batchTransfer(
    address token,
    address[] calldata receivers,
    uint256[] calldata amounts
  ) external onlyRole(BATCH_TRANSFER_ROLE) {
    for (uint256 i = 0; i < receivers.length; i++) {
      _checkRole(TOKEN_RECEIVER_ROLE, receivers[i]);
      IERC20(token).safeTransfer(receivers[i], amounts[i]);
    }
  }

  /// @notice Buyback fxUSD with stable reserve in FxUSDSave.
  /// @param pegKeeper The address of peg keeper.
  /// @param amountIn The amount of stable token to use.
  /// @param data The hook data to `onSwap`.
  /// @return amountOut The amount of fxUSD swapped.
  /// @return bonus The amount of bonus fxUSD.
  function buyback(
    address pegKeeper,
    uint256 amountIn,
    bytes calldata data
  ) external onlyRole(BUYBACK_ROLE) returns (uint256 amountOut, uint256 bonus) {
    (amountOut, bonus) = PegKeeper(pegKeeper).buyback(amountIn, data);
  }

  /// @notice Stabilize the fxUSD price in curve pool.
  /// @param pegKeeper The address of peg keeper.
  /// @param srcToken The address of source token (fxUSD or stable token).
  /// @param amountIn The amount of source token to use.
  /// @param data The hook data to `onSwap`.
  /// @return amountOut The amount of target token swapped.
  /// @return bonus The amount of bonus token.
  function stabilize(
    address pegKeeper,
    address srcToken,
    uint256 amountIn,
    bytes calldata data
  ) external onlyRole(STABILIZE_ROLE) returns (uint256 amountOut, uint256 bonus) {
    (amountOut, bonus) = PegKeeper(pegKeeper).stabilize(srcToken, amountIn, data);
  }
}
