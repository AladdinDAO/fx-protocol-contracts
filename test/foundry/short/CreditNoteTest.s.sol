// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";

import { IERC20Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import { CreditNote } from "../../../contracts/core/short/CreditNote.sol";

contract CreditNoteTest is Test {
  CreditNote public creditNote;
  address public poolManager;
  address public user;

  function setUp() public {
    poolManager = makeAddr("poolManager");
    user = makeAddr("user");

    creditNote = new CreditNote(poolManager);
    creditNote.initialize("Credit Note", "CN", 18);
  }

  function test_Initialize() public {
    assertEq(creditNote.name(), "Credit Note");
    assertEq(creditNote.symbol(), "CN");
    assertEq(creditNote.poolManager(), poolManager);
  }

  function test_Mint() public {
    uint256 amount = 1000e18;

    vm.prank(poolManager);
    creditNote.mint(user, amount);

    assertEq(creditNote.balanceOf(user), amount);
  }

  function test_Mint_Unauthorized() public {
    uint256 amount = 1000e18;

    vm.prank(user);
    vm.expectRevert(CreditNote.ErrorUnauthorized.selector);
    creditNote.mint(user, amount);
  }

  function test_Burn() public {
    uint256 amount = 1000e18;

    // First mint some tokens
    vm.prank(poolManager);
    creditNote.mint(user, amount);

    // Then burn them
    vm.prank(poolManager);
    creditNote.burn(user, amount);

    assertEq(creditNote.balanceOf(user), 0);
  }

  function test_Burn_Unauthorized() public {
    uint256 amount = 1000e18;

    // First mint some tokens
    vm.prank(poolManager);
    creditNote.mint(user, amount);

    // Try to burn without authorization
    vm.prank(user);
    vm.expectRevert(CreditNote.ErrorUnauthorized.selector);
    creditNote.burn(user, amount);
  }

  function test_Burn_InsufficientBalance() public {
    uint256 amount = 1000e18;

    vm.prank(poolManager);
    vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, user, 0, amount));
    creditNote.burn(user, amount);
  }
}
