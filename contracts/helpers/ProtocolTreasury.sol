// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IHarvesterCallback } from "./interfaces/IHarvesterCallback.sol";

import { PermissionedSwap } from "../common/utils/PermissionedSwap.sol";

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
}
