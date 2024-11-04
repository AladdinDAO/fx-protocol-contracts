// SPDX-License-Identifier: MIT

pragma solidity ^0.8.25;

import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable-v4/security/ReentrancyGuardUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/IERC20Upgradeable.sol";

import { IERC3156FlashBorrower } from "../common/ERC3156/IERC3156FlashBorrower.sol";
import { IERC3156FlashLender } from "../common/ERC3156/IERC3156FlashLender.sol";

import { ProtocolFees } from "./ProtocolFees.sol";

contract FlashLoans is ProtocolFees, ReentrancyGuardUpgradeable, IERC3156FlashLender {
  using SafeERC20Upgradeable for IERC20Upgradeable;

  /**********
   * Errors *
   **********/

  /// @dev Thrown when the returned balance after flash loan is not enough.
  error ErrorInsufficientFlashLoanReturn();

  /// @dev Thrown when the returned value of `ERC3156Callback` is wrong.
  error ErrorERC3156CallbackFailed();

  /*************
   * Constants *
   *************/

  /// @dev The correct value of the return value of `ERC3156FlashBorrower.onFlashLoan`.
  bytes32 private constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

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

  /// @inheritdoc IERC3156FlashLender
  function maxFlashLoan(address token) external view override returns (uint256) {
    return IERC20Upgradeable(token).balanceOf(address(this));
  }

  /// @inheritdoc IERC3156FlashLender
  function flashFee(
    address, /*token*/
    uint256 amount
  ) public view returns (uint256) {
    return (amount * getFlashLoanFeeRatio()) / FEE_PRECISION;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IERC3156FlashLender
  function flashLoan(
    IERC3156FlashBorrower receiver,
    address token,
    uint256 amount,
    bytes calldata data
  ) external nonReentrant returns (bool) {
    // save the current balance
    uint256 prevBalance = IERC20Upgradeable(token).balanceOf(address(this));
    uint256 fee = flashFee(token, amount);

    // transfer token to receiver
    IERC20Upgradeable(token).safeTransfer(address(receiver), amount);

    // invoke the recipient's callback
    if (receiver.onFlashLoan(_msgSender(), token, amount, fee, data) != CALLBACK_SUCCESS) {
      revert ErrorERC3156CallbackFailed();
    }

    // ensure that the tokens + fee have been deposited back to the network
    uint256 returnedAmount = IERC20Upgradeable(token).balanceOf(address(this)) - prevBalance;
    if (returnedAmount < amount + fee) {
      revert ErrorInsufficientFlashLoanReturn();
    }

    IERC20Upgradeable(token).safeTransfer(platform, fee);

    return true;
  }
}
