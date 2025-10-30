// SPDX-License-Identifier: MIT

pragma solidity ^0.8.25;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import { ProtocolFees } from "./ProtocolFees.sol";

/// @custom:deprecated
contract FlashLoans is ProtocolFees, ReentrancyGuardUpgradeable {
  using SafeERC20 for IERC20;

  /*************
   * Variables *
   *************/

  /// @dev Slots for future use.
  uint256[50] private _gap;

  /***************
   * Constructor *
   ***************/

  function __FlashLoans_init() internal onlyInitializing {}

  /*************************
   * Public View Functions *
   *************************/

  /****************************
   * Public Mutated Functions *
   ****************************/
}
