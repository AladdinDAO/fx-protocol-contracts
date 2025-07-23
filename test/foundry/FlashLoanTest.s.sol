// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { console } from "forge-std/console.sol";
import { Test } from "forge-std/Test.sol";

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IERC3156FlashBorrower } from "../../contracts/common/ERC3156/IERC3156FlashBorrower.sol";
import { FlashLoans } from "../../contracts/core/FlashLoans.sol";
import { PoolManager } from "../../contracts/core/PoolManager.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";

contract FlashLoanTest is Test, IERC3156FlashBorrower {
  address public treasury;

  MockERC20 public token;
  PoolManager public poolManager;

  function setUp() public {
    treasury = address(uint160(address(this)) - 1);
    token = new MockERC20("x", "y", 18);
    poolManager = new PoolManager(address(0), address(0), address(0), address(0));
    poolManager.initialize(address(this), 0, 0, 10000, treasury, address(this), address(this));
  }

  function testFlashloan(uint256 loanAmount, uint256 flashLoanFeeRatio) public {
    flashLoanFeeRatio = bound(flashLoanFeeRatio, 0, 1e8);
    loanAmount = bound(loanAmount, 1, type(uint128).max);
    token.mint(address(poolManager), loanAmount);

    bytes memory data = new bytes(0);
    vm.expectRevert(FlashLoans.ErrorInsufficientFlashLoanReturn.selector);
    poolManager.flashLoan(IERC3156FlashBorrower(address(this)), address(token), loanAmount, data);
    assertEq(IERC20(token).balanceOf(address(poolManager)), loanAmount);

    data = hex"01";
    uint256 balanceBefore = IERC20(token).balanceOf(treasury);
    poolManager.flashLoan(IERC3156FlashBorrower(address(this)), address(token), loanAmount, data);
    uint256 balanceAfter = IERC20(token).balanceOf(treasury);
    assertEq(balanceAfter - balanceBefore, poolManager.flashFee(address(token), loanAmount));
    assertEq(IERC20(token).balanceOf(address(poolManager)), loanAmount);
  }

  function onFlashLoan(
    address initiator,
    address asset,
    uint amount,
    uint fee,
    bytes memory data
  ) public returns (bytes32) {
    uint256 balance = IERC20(asset).balanceOf(address(this));
    assertEq(balance, amount);
    token.mint(address(this), fee);
    if (data.length != 0) {
      console.log("Pass with correct amount and fees");
      IERC20(asset).transfer(msg.sender, amount + fee);
    } else {
      console.log("Fail with incorrect amount and fees");
      IERC20(asset).transfer(msg.sender, amount + fee - 1);
    }
    return keccak256("ERC3156FlashBorrower.onFlashLoan");
  }
}
