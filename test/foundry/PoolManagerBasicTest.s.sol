// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { console } from "forge-std/console.sol";

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ITransparentUpgradeableProxy } from "@openzeppelin/contracts-v4/proxy/transparent/TransparentUpgradeableProxy.sol";

import { ProtocolFees } from "../../contracts/core/ProtocolFees.sol";
import { PoolManager } from "../../contracts/core/PoolManager.sol";
import { IPoolManager } from "../../contracts/interfaces/IPoolManager.sol";
import { IPool } from "../../contracts/interfaces/IPool.sol";

import { MockRateProvider } from "../../contracts/mocks/MockRateProvider.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";

import { PoolTestBase } from "../../test/foundry/PoolTestBase.s.sol";

contract MockPoolManager is PoolManager {
  constructor(
    address _fxUSD,
    address _fxBASE,
    address _counterparty,
    address _configuration,
    address _whitelist
  ) PoolManager(_fxUSD, _fxBASE, _counterparty, _configuration, _whitelist) {}

  function setAccumulatedPoolFees(address pool, uint256 openFees, uint256 closeFees, uint256 miscFees) public {
    accumulatedPoolOpenFees[pool] = openFees;
    accumulatedPoolCloseFees[pool] = closeFees;
    accumulatedPoolMiscFees[pool] = miscFees;
  }
}

contract PoolManagerBasicTest is PoolTestBase {
  event UpdateReservePool(address indexed oldReservePool, address indexed newReservePool);
  event UpdateTreasury(address indexed oldTreasury, address indexed newTreasury);
  event UpdateOpenRevenuePool(address indexed oldPool, address indexed newPool);
  event UpdateCloseRevenuePool(address indexed oldPool, address indexed newPool);
  event UpdateMiscRevenuePool(address indexed oldPool, address indexed newPool);
  event UpdateRewardsExpenseRatio(uint256 oldRatio, uint256 newRatio);
  event UpdateFundingExpenseRatio(uint256 oldRatio, uint256 newRatio);
  event UpdateLiquidationExpenseRatio(uint256 oldRatio, uint256 newRatio);
  event UpdateHarvesterRatio(uint256 oldRatio, uint256 newRatio);
  event UpdateFlashLoanFeeRatio(uint256 oldRatio, uint256 newRatio);
  event UpdateRedeemFeeRatio(uint256 oldRatio, uint256 newRatio);
  event RegisterPool(address indexed pool);
  event UpdateRewardSplitter(address indexed pool, address indexed oldSplitter, address indexed newSplitter);
  event UpdateTokenRate(address indexed token, uint256 scalar, address provider);
  event UpdatePoolCapacity(address indexed pool, uint256 collateralCapacity, uint256 debtCapacity);
  event UpdatePermissionedLiquidationThreshold(uint256 oldThreshold, uint256 newThreshold);
  event UpdateShortBorrowCapacityRatio(address indexed longPool, uint256 oldRatio, uint256 newRatio);

  address nonAdmin;

  function setUp() public {
    __PoolTestBase_setUp(1.23 ether, 18);
    nonAdmin = makeAddr("nonAdmin");
  }

  function test_UpdateExpenseRatio(uint32 rewardsRatio, uint32 fundingRatio, uint32 liquidationRatio) public {
    rewardsRatio = uint32(bound(rewardsRatio, 0, 5e8));
    fundingRatio = uint32(bound(fundingRatio, 0, 5e8));
    liquidationRatio = uint32(bound(liquidationRatio, 0, 5e8));

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.DEFAULT_ADMIN_ROLE()
      )
    );
    poolManager.updateExpenseRatio(rewardsRatio, fundingRatio, liquidationRatio);
    vm.stopPrank();

    // revert when rewardsRatio too large
    vm.expectRevert(ProtocolFees.ErrorValueTooLarge.selector);
    poolManager.updateExpenseRatio(5e8 + 1, fundingRatio, liquidationRatio);
    // revert when fundingRatio too large
    vm.expectRevert(ProtocolFees.ErrorValueTooLarge.selector);
    poolManager.updateExpenseRatio(rewardsRatio, 5e8 + 1, liquidationRatio);
    // revert when liquidationRatio too large
    vm.expectRevert(ProtocolFees.ErrorValueTooLarge.selector);
    poolManager.updateExpenseRatio(rewardsRatio, fundingRatio, 5e8 + 1);

    // Test event emissions
    vm.expectEmit(true, true, true, true);
    emit UpdateRewardsExpenseRatio(0, rewardsRatio);
    vm.expectEmit(true, true, true, true);
    emit UpdateFundingExpenseRatio(0, fundingRatio);
    vm.expectEmit(true, true, true, true);
    emit UpdateLiquidationExpenseRatio(0, liquidationRatio);
    poolManager.updateExpenseRatio(rewardsRatio, fundingRatio, liquidationRatio);

    // Verify updated ratios
    assertEq(poolManager.getRewardsExpenseRatio(), rewardsRatio);
    assertEq(poolManager.getFundingExpenseRatio(), fundingRatio);
    assertEq(poolManager.getLiquidationExpenseRatio(), liquidationRatio);
  }

  function test_UpdateHarvesterRatio(uint32 ratio) public {
    ratio = uint32(bound(ratio, 0, 2e8));

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.DEFAULT_ADMIN_ROLE()
      )
    );
    poolManager.updateHarvesterRatio(ratio);
    vm.stopPrank();

    // revert when ratio too large
    vm.expectRevert(ProtocolFees.ErrorValueTooLarge.selector);
    poolManager.updateHarvesterRatio(2e8 + 1);

    // Test event emission
    vm.expectEmit(true, true, true, true);
    emit UpdateHarvesterRatio(0, ratio);
    poolManager.updateHarvesterRatio(ratio);
    assertEq(poolManager.getHarvesterRatio(), ratio);
  }

  function test_UpdateFlashLoanFeeRatio(uint32 ratio) public {
    ratio = uint32(bound(ratio, 0, 1e8));

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.DEFAULT_ADMIN_ROLE()
      )
    );
    poolManager.updateFlashLoanFeeRatio(ratio);
    vm.stopPrank();

    // revert when ratio too large
    vm.expectRevert(ProtocolFees.ErrorValueTooLarge.selector);
    poolManager.updateFlashLoanFeeRatio(1e8 + 1);

    // Test event emission
    vm.expectEmit(true, true, true, true);
    emit UpdateFlashLoanFeeRatio(0, ratio);
    poolManager.updateFlashLoanFeeRatio(ratio);
    assertEq(poolManager.getFlashLoanFeeRatio(), ratio);
  }

  function test_UpdateRedeemFeeRatio(uint32 ratio) public {
    ratio = uint32(bound(ratio, 0, 1e8));

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.DEFAULT_ADMIN_ROLE()
      )
    );
    poolManager.updateRedeemFeeRatio(ratio);
    vm.stopPrank();

    // revert when ratio too large
    vm.expectRevert(ProtocolFees.ErrorValueTooLarge.selector);
    poolManager.updateRedeemFeeRatio(1e8 + 1);

    // Test event emission
    vm.expectEmit(true, true, true, true);
    emit UpdateRedeemFeeRatio(0, ratio);
    poolManager.updateRedeemFeeRatio(ratio);
    assertEq(poolManager.getRedeemFeeRatio(), ratio);
  }

  function test_UpdateRevenuePools(address newOpenPool, address newClosePool, address newMiscPool) public {
    vm.assume(newOpenPool != address(0));
    vm.assume(newClosePool != address(0));
    vm.assume(newMiscPool != address(0));

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.DEFAULT_ADMIN_ROLE()
      )
    );
    poolManager.updateOpenRevenuePool(newOpenPool);
    vm.stopPrank();

    // revert when open pool is zero address
    vm.expectRevert(ProtocolFees.ErrorZeroAddress.selector);
    poolManager.updateOpenRevenuePool(address(0));

    // revert when close pool is zero address
    vm.expectRevert(ProtocolFees.ErrorZeroAddress.selector);
    poolManager.updateCloseRevenuePool(address(0));

    // revert when misc pool is zero address
    vm.expectRevert(ProtocolFees.ErrorZeroAddress.selector);
    poolManager.updateMiscRevenuePool(address(0));

    // Test event emissions
    vm.expectEmit(true, true, true, true);
    emit UpdateOpenRevenuePool(address(openRevenuePool), newOpenPool);
    poolManager.updateOpenRevenuePool(newOpenPool);

    vm.expectEmit(true, true, true, true);
    emit UpdateCloseRevenuePool(address(closeRevenuePool), newClosePool);
    poolManager.updateCloseRevenuePool(newClosePool);

    vm.expectEmit(true, true, true, true);
    emit UpdateMiscRevenuePool(address(miscRevenuePool), newMiscPool);
    poolManager.updateMiscRevenuePool(newMiscPool);

    // Verify updated pools
    assertEq(poolManager.openRevenuePool(), newOpenPool);
    assertEq(poolManager.closeRevenuePool(), newClosePool);
    assertEq(poolManager.miscRevenuePool(), newMiscPool);
  }

  function test_UpdateReservePool(address newReservePool) public {
    vm.assume(newReservePool != address(0));

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.DEFAULT_ADMIN_ROLE()
      )
    );
    poolManager.updateReservePool(newReservePool);
    vm.stopPrank();

    // revert when reserve pool is zero address
    vm.expectRevert(ProtocolFees.ErrorZeroAddress.selector);
    poolManager.updateReservePool(address(0));

    // Test event emission
    vm.expectEmit(true, true, true, true);
    emit UpdateReservePool(address(reservePool), newReservePool);
    poolManager.updateReservePool(newReservePool);
    assertEq(poolManager.reservePool(), newReservePool);
  }

  function test_UpdateTreasury(address newTreasury) public {
    vm.assume(newTreasury != address(0));

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.DEFAULT_ADMIN_ROLE()
      )
    );
    poolManager.updateTreasury(newTreasury);
    vm.stopPrank();

    // revert when treasury is zero address
    vm.expectRevert(ProtocolFees.ErrorZeroAddress.selector);
    poolManager.updateTreasury(address(0));

    // Test event emission
    vm.expectEmit(true, true, true, true);
    emit UpdateTreasury(address(treasury), newTreasury);
    poolManager.updateTreasury(newTreasury);
    assertEq(poolManager.treasury(), newTreasury);
  }

  function test_WithdrawAccumulatedPoolFee(uint256 openFees, uint256 closeFees, uint256 miscFees) public {
    openFees = bound(openFees, 0, 1000 ether);
    closeFees = bound(closeFees, 0, 1000 ether);
    miscFees = bound(miscFees, 0, 1000 ether);

    // upgrade to MockPoolManager
    MockPoolManager impl = new MockPoolManager(
      address(fxUSD),
      address(fxBASE),
      address(shortPoolManager),
      address(poolConfiguration),
      address(whitelist)
    );
    proxyAdmin.upgrade(ITransparentUpgradeableProxy(address(poolManager)), address(impl));

    // set accumulated pool fees
    MockPoolManager(address(poolManager)).setAccumulatedPoolFees(address(longPool), openFees, closeFees, miscFees);

    collateralToken.mint(address(poolManager), openFees + closeFees + miscFees);

    address[] memory pools = new address[](1);
    pools[0] = address(longPool);

    // withdraw accumulated pool fees
    assertEq(poolManager.accumulatedPoolOpenFees(address(longPool)), openFees);
    assertEq(poolManager.accumulatedPoolCloseFees(address(longPool)), closeFees);
    assertEq(poolManager.accumulatedPoolMiscFees(address(longPool)), miscFees);
    assertEq(IERC20(address(collateralToken)).balanceOf(address(poolManager)), openFees + closeFees + miscFees);
    assertEq(IERC20(address(collateralToken)).balanceOf(address(openRevenuePool)), 0);
    assertEq(IERC20(address(collateralToken)).balanceOf(address(closeRevenuePool)), 0);
    assertEq(IERC20(address(collateralToken)).balanceOf(address(miscRevenuePool)), 0);
    poolManager.withdrawAccumulatedPoolFee(pools);
    assertEq(poolManager.accumulatedPoolOpenFees(address(longPool)), 0);
    assertEq(poolManager.accumulatedPoolCloseFees(address(longPool)), 0);
    assertEq(poolManager.accumulatedPoolMiscFees(address(longPool)), 0);
    assertEq(IERC20(address(collateralToken)).balanceOf(address(poolManager)), 0);
    assertEq(IERC20(address(collateralToken)).balanceOf(address(openRevenuePool)), openFees);
    assertEq(IERC20(address(collateralToken)).balanceOf(address(closeRevenuePool)), closeFees);
    assertEq(IERC20(address(collateralToken)).balanceOf(address(miscRevenuePool)), miscFees);
  }

  function test_SetPause(bool paused) public {
    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.EMERGENCY_ROLE()
      )
    );
    poolManager.setPause(paused);
    vm.stopPrank();

    poolManager.grantRole(poolManager.EMERGENCY_ROLE(), address(this));
    bool currentPaused = poolManager.paused();
    if (poolManager.paused()) {
      poolManager.setPause(false);
    } else {
      poolManager.setPause(true);
    }
    assertEq(poolManager.paused(), !currentPaused);
    currentPaused = poolManager.paused();
    if (poolManager.paused()) {
      poolManager.setPause(false);
    } else {
      poolManager.setPause(true);
    }
    assertEq(poolManager.paused(), !currentPaused);
  }

  function test_RegisterPool(address pool, address rewarder, uint96 collateralCapacity, uint96 debtCapacity) public {
    vm.assume(pool != address(longPool));
    collateralCapacity = uint96(bound(collateralCapacity, 0, (2 ** 85) - 1));
    debtCapacity = uint96(bound(debtCapacity, 0, (2 ** 96) - 1));

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.DEFAULT_ADMIN_ROLE()
      )
    );
    poolManager.registerPool(address(longPool), collateralCapacity, debtCapacity);
    vm.stopPrank();

    // Test event emission
    vm.expectEmit(true, true, true, true);
    emit RegisterPool(address(pool));
    poolManager.registerPool(address(pool), collateralCapacity, debtCapacity);

    // Verify pool info
    (uint256 cap, uint256 bal, uint256 raw, uint256 debtCap, uint256 debtBal) = poolManager.getPoolInfo(address(pool));
    assertEq(cap, collateralCapacity);
    assertEq(bal, 0);
    assertEq(raw, 0);
    assertEq(debtCap, debtCapacity);
    assertEq(debtBal, 0);
  }

  function test_UpdateRateProvider(uint256 decimals, uint256 rate) public {
    decimals = bound(decimals, 0, 18);
    rate = bound(rate, 1e18, 1e20);
    MockERC20 token = new MockERC20("TEST", "TEST", uint8(decimals));
    MockRateProvider newRateProvider = new MockRateProvider(rate);
    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.DEFAULT_ADMIN_ROLE()
      )
    );
    poolManager.updateRateProvider(address(token), address(newRateProvider));
    vm.stopPrank();

    // Test event emission
    vm.expectEmit(true, true, true, true);
    emit UpdateTokenRate(address(token), 10 ** (18 - decimals), address(newRateProvider));
    poolManager.updateRateProvider(address(token), address(newRateProvider));
    (uint256 scalar, address rateProvider) = poolManager.tokenRates(address(token));
    assertEq(scalar, 10 ** (18 - decimals));
    assertEq(rateProvider, address(newRateProvider));
  }

  function test_UpdatePoolCapacity(address pool, uint96 newCollateralCapacity, uint96 newDebtCapacity) public {
    vm.assume(pool != address(longPool));
    newCollateralCapacity = uint96(bound(newCollateralCapacity, 0, (2 ** 85) - 1));
    newDebtCapacity = uint96(bound(newDebtCapacity, 0, (2 ** 96) - 1));

    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.DEFAULT_ADMIN_ROLE()
      )
    );
    poolManager.updatePoolCapacity(pool, newCollateralCapacity, newDebtCapacity);
    vm.stopPrank();

    // revert when pool is not registered
    vm.expectRevert(PoolManager.ErrorPoolNotRegistered.selector);
    poolManager.updatePoolCapacity(pool, newCollateralCapacity, newDebtCapacity);

    // Test event emission
    vm.expectEmit(true, true, true, true);
    emit UpdatePoolCapacity(address(longPool), newCollateralCapacity, newDebtCapacity);
    poolManager.updatePoolCapacity(address(longPool), newCollateralCapacity, newDebtCapacity);

    // Verify updated capacity
    (uint256 cap, , , uint256 debtCap, ) = poolManager.getPoolInfo(address(longPool));
    assertEq(cap, newCollateralCapacity);
    assertEq(debtCap, newDebtCapacity);
  }

  function test_UpdateThreshold(uint96 newThreshold) public {
    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.DEFAULT_ADMIN_ROLE()
      )
    );
    poolManager.updateThreshold(newThreshold);
    vm.stopPrank();

    // Test event emission
    vm.expectEmit(true, true, true, true);
    emit UpdatePermissionedLiquidationThreshold(poolManager.permissionedLiquidationThreshold(), newThreshold);
    poolManager.updateThreshold(newThreshold);
    assertEq(poolManager.permissionedLiquidationThreshold(), newThreshold);
  }

  function test_UpdateShortBorrowCapacityRatio(uint96 newRatio) public {
    // Test non-admin access first
    vm.startPrank(nonAdmin);
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        nonAdmin,
        poolManager.DEFAULT_ADMIN_ROLE()
      )
    );
    poolManager.updateShortBorrowCapacityRatio(address(longPool), newRatio);
    vm.stopPrank();

    // Test event emission
    vm.expectEmit(true, true, true, true);
    emit UpdateShortBorrowCapacityRatio(
      address(longPool),
      poolManager.shortBorrowCapacityRatio(address(longPool)),
      newRatio
    );
    poolManager.updateShortBorrowCapacityRatio(address(longPool), newRatio);
    assertEq(poolManager.shortBorrowCapacityRatio(address(longPool)), newRatio);
  }
}
