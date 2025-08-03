// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

import { PoolErrors } from "../../contracts/core/pool/PoolErrors.sol";
import { MockPriceOracle } from "../../contracts/mocks/MockPriceOracle.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";

import { PoolTestBase } from "./PoolTestBase.s.sol";

contract BasePoolTest is PoolTestBase {
  event UpdatePriceOracle(address oldOracle, address newOracle);
  event UpdateBorrowStatus(bool status);
  event UpdateRedeemStatus(bool status);
  event UpdateDebtRatioRange(uint256 minDebtRatio, uint256 maxDebtRatio);
  event UpdateMaxRedeemRatioPerTick(uint256 ratio);
  event UpdateRebalanceRatios(uint256 debtRatio, uint256 bonusRatio);
  event UpdateLiquidateRatios(uint256 debtRatio, uint256 bonusRatio);
  event UpdateCounterparty(address oldCounterparty, address newCounterparty);

  address nonAdmin;

  function setUp() public {
    __PoolTestBase_setUp(1.23 ether, 18);
    nonAdmin = makeAddr("nonAdmin");
  }

  function test_UpdateBorrowAndRedeemStatus() public {
    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        longPool.EMERGENCY_ROLE()
      )
    );
    longPool.updateBorrowAndRedeemStatus(false, false);
    vm.stopPrank();

    longPool.grantRole(longPool.EMERGENCY_ROLE(), address(this));

    // Test updating both statuses
    vm.expectEmit(true, true, true, true);
    emit UpdateBorrowStatus(false);
    emit UpdateRedeemStatus(true);
    longPool.updateBorrowAndRedeemStatus(false, true);
    assertFalse(longPool.isBorrowPaused());
    assertTrue(longPool.isRedeemPaused());

    vm.expectEmit(true, true, true, true);
    emit UpdateBorrowStatus(true);
    emit UpdateRedeemStatus(false);
    longPool.updateBorrowAndRedeemStatus(true, false);
    assertTrue(longPool.isBorrowPaused());
    assertFalse(longPool.isRedeemPaused());
  }

  function test_UpdateDebtRatioRange(uint256 minRatio, uint256 maxRatio) public {
    minRatio = bound(minRatio, 1, 1e18 - 1);
    maxRatio = bound(maxRatio, minRatio + 1, 1e18);

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        longPool.DEFAULT_ADMIN_ROLE()
      )
    );
    longPool.updateDebtRatioRange(minRatio, maxRatio);
    vm.stopPrank();

    /*
    // revert if maxRatio > 1e18
    vm.expectRevert(PoolErrors.ErrorValueTooLarge.selector);
    longPool.updateDebtRatioRange(minRatio, 1e18 + 1);
    // revert if minRatio > maxRatio
    vm.expectRevert(PoolErrors.ErrorValueTooLarge.selector);
    longPool.updateDebtRatioRange(minRatio + 1, minRatio);
    */

    // Test updating debt ratio range
    vm.expectEmit(true, true, true, true);
    emit UpdateDebtRatioRange(minRatio, maxRatio);
    longPool.updateDebtRatioRange(minRatio, maxRatio);
    (uint256 actualMinRatio, uint256 actualMaxRatio) = longPool.getDebtRatioRange();
    assertEq(actualMinRatio, minRatio);
    assertEq(actualMaxRatio, maxRatio);
  }

  function test_UpdateMaxRedeemRatioPerTick(uint256 ratio) public {
    ratio = bound(ratio, 0, 1e9);

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        longPool.DEFAULT_ADMIN_ROLE()
      )
    );
    longPool.updateMaxRedeemRatioPerTick(ratio);
    vm.stopPrank();

    /*
    // revert if ratio is too large
    vm.expectRevert(PoolErrors.ErrorValueTooLarge.selector);
    longPool.updateMaxRedeemRatioPerTick(1e9 + 1);
    */

    // Test updating max redeem ratio
    vm.expectEmit(true, true, true, true);
    emit UpdateMaxRedeemRatioPerTick(ratio);
    longPool.updateMaxRedeemRatioPerTick(ratio);
    assertEq(longPool.getMaxRedeemRatioPerTick(), ratio);
  }

  function test_UpdateRebalanceRatios(uint256 debtRatio, uint256 bonusRatio) public {
    debtRatio = bound(debtRatio, 0, 1e18);
    bonusRatio = bound(bonusRatio, 0, 1e9);

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        longPool.DEFAULT_ADMIN_ROLE()
      )
    );
    longPool.updateRebalanceRatios(debtRatio, bonusRatio);
    vm.stopPrank();

    /*
    // revert if bonusRatio is too large
    vm.expectRevert(PoolErrors.ErrorValueTooLarge.selector);
    longPool.updateRebalanceRatios(debtRatio, 1e9 + 1);
    */

    // Test updating rebalance ratios
    vm.expectEmit(true, true, true, true);
    emit UpdateRebalanceRatios(debtRatio, bonusRatio);
    longPool.updateRebalanceRatios(debtRatio, bonusRatio);
    (uint256 actualDebtRatio, uint256 actualBonusRatio) = longPool.getRebalanceRatios();
    assertEq(actualDebtRatio, debtRatio);
    assertEq(actualBonusRatio, bonusRatio);
  }

  function test_UpdateLiquidateRatios(uint256 debtRatio, uint256 bonusRatio) public {
    debtRatio = bound(debtRatio, 0, 1e18);
    bonusRatio = bound(bonusRatio, 0, 1e9);

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        longPool.DEFAULT_ADMIN_ROLE()
      )
    );
    longPool.updateLiquidateRatios(debtRatio, bonusRatio);
    vm.stopPrank();

    /*
    // revert if bonusRatio is too large
    vm.expectRevert(PoolErrors.ErrorValueTooLarge.selector);
    longPool.updateLiquidateRatios(debtRatio, 1e9 + 1);
    */

    // Test updating liquidate ratios
    vm.expectEmit(true, true, true, true);
    emit UpdateLiquidateRatios(debtRatio, bonusRatio);
    longPool.updateLiquidateRatios(debtRatio, bonusRatio);
    (uint256 actualDebtRatio, uint256 actualBonusRatio) = longPool.getLiquidateRatios();
    assertEq(actualDebtRatio, debtRatio);
    assertEq(actualBonusRatio, bonusRatio);
  }

  function test_UpdatePriceOracle() public {
    MockPriceOracle newOracle = new MockPriceOracle(0, 0, 0);

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        longPool.DEFAULT_ADMIN_ROLE()
      )
    );
    longPool.updatePriceOracle(address(newOracle));
    vm.stopPrank();

    /*
    // revert if new oracle is zero address
    vm.expectRevert(PoolErrors.ErrorZeroAddress.selector);
    longPool.updatePriceOracle(address(0));
    */

    // Test updating price oracle
    vm.expectEmit(true, true, true, true);
    emit UpdatePriceOracle(longPool.priceOracle(), address(newOracle));
    longPool.updatePriceOracle(address(newOracle));
    assertEq(longPool.priceOracle(), address(newOracle));
  }

  function test_UpdateCounterparty() public {
    address newCounterparty = makeAddr("newCounterparty");

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        longPool.DEFAULT_ADMIN_ROLE()
      )
    );
    longPool.updateCounterparty(newCounterparty);
    vm.stopPrank();

    // revert if new counterparty is zero address
    vm.expectRevert(PoolErrors.ErrorZeroAddress.selector);
    longPool.updateCounterparty(address(0));

    // Test updating counterparty
    vm.expectEmit(true, true, true, true);
    emit UpdateCounterparty(longPool.counterparty(), newCounterparty);
    longPool.updateCounterparty(newCounterparty);
    assertEq(longPool.counterparty(), newCounterparty);
  }
}
