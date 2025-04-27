// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IPancake } from "../../interfaces/Pancake/IPancake.sol";

import { LibRouter } from "../libraries/LibRouter.sol";

import { IPool } from "../../interfaces/IPool.sol";

abstract contract PancakeFlashLoanFacetBase {
  using SafeERC20 for IERC20;
  /**********
   * Errors *
   **********/

  /// @dev Thrown when the caller is not self.
  error ErrorNotFromSelf();

  /// @dev Unauthorized reentrant call.
  error ReentrancyGuardReentrantCall();

  /// @dev Thrown when the caller is not pancakePool.
  error ErrorNotFromPancake();

  error ErrorNotFromRouterFlashLoan();

  error ErrorPancakeFlashLoanFee();

  /***********************
   * Immutable Variables *
   ***********************/

  /// @dev The address of Pancake Pool contract.
  address private immutable pancakePool;

  /*************
   * Modifiers *
   *************/

  modifier onlySelf() {
    if (msg.sender != address(this)) revert ErrorNotFromSelf();
    _;
  }

  modifier onFlashLoan() {
    LibRouter.RouterStorage storage $ = LibRouter.routerStorage();
    $.flashLoanContext = LibRouter.HAS_FLASH_LOAN;
    _;
    $.flashLoanContext = LibRouter.NOT_FLASH_LOAN;
  }

  modifier nonReentrant() {
    LibRouter.RouterStorage storage $ = LibRouter.routerStorage();
    if ($.reentrantContext == LibRouter.HAS_ENTRANT) {
      revert ReentrancyGuardReentrantCall();
    }
    $.reentrantContext = LibRouter.HAS_ENTRANT;
    _;
    $.reentrantContext = LibRouter.NOT_ENTRANT;
  }

  /***************
   * Constructor *
   ***************/

  constructor(address _pancakePool) {
    pancakePool = _pancakePool;
  }

  /**********************
   * Internal Functions *
   **********************/

  function _invokeFlashLoan(address token, uint256 amount, bytes memory data) internal onFlashLoan {
    IPancake(pancakePool).flash(address(this), 0, amount, data);
  }

  function pancakeV3FlashCallback(
      uint256 fee0,
      uint256 fee1,
      bytes calldata data
  ) external {
    if (msg.sender != pancakePool) revert ErrorNotFromPancake();

    // make sure call invoked by router
    LibRouter.RouterStorage storage $ = LibRouter.routerStorage();
    if ($.flashLoanContext != LibRouter.HAS_FLASH_LOAN) revert ErrorNotFromRouterFlashLoan();
    //decode data
    bytes memory argsData = data[4:];
    (
      address pool,
      ,
      ,
      uint256 borrowAmount,
      uint256 borrowfee,
      ,
      
    ) = abi.decode(
      argsData,
      (address, uint256, uint256, uint256, uint256, address, bytes)
    );
    if (borrowfee < fee1) revert ErrorPancakeFlashLoanFee();
    
    (bool success, ) = address(this).call(data);
    // below lines will propagate inner error up
    if (!success) {
      // solhint-disable-next-line no-inline-assembly
      assembly {
        let ptr := mload(0x40)
        let size := returndatasize()
        returndatacopy(ptr, 0, size)
        revert(ptr, size)
      }
    }

    //pay back flashloan
    IERC20(IPool(pool).collateralToken()).safeTransfer(msg.sender, borrowAmount + fee1);
  }



}
