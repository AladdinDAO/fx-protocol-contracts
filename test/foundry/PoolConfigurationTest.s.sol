// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { PoolTestBase } from "./PoolTestBase.s.sol";
import { PoolConfiguration } from "../../contracts/core/PoolConfiguration.sol";
import { MockPriceOracle } from "../../contracts/mocks/MockPriceOracle.sol";
import { MockAaveV3Pool } from "../../contracts/mocks/MockAaveV3Pool.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";

contract PoolConfigurationTest is PoolTestBase {
  event UpdateOracle(address indexed oldOracle, address indexed newOracle);
  event UpdatePoolFeeRatio(
    address indexed pool,
    address indexed recipient,
    uint256 supplyRatio,
    uint256 supplyRatioStep,
    uint256 withdrawFeeRatio,
    uint256 borrowFeeRatio,
    uint256 repayFeeRatio
  );
  event UpdateLongFundingRatioParameter(uint64 scalarA, uint64 scalarB, uint64 maxFxUSDRatio);
  event UpdateShortFundingRatioParameter(uint64 scalarC, uint64 maxBorrowRatio);
  event Snapshot(uint256 borrowIndex, uint256 lastInterestRate, uint256 timestamp);
  event UpdateStableDepegPrice(uint256 oldStableDepegPrice, uint256 newStableDepegPrice);

  address alice = makeAddr("alice");

  function setUp() public {
    vm.warp(1e9);

    __PoolTestBase_setUp(1e18, 18);
  }

  function test_Initialize() public {
    assertEq(poolConfiguration.AAVE_LENDING_POOL(), address(mockAaveV3Pool));
    assertEq(poolConfiguration.AAVE_BASE_ASSET(), address(stableToken));
    assertEq(poolConfiguration.FXUSD_BASE_POOL(), address(fxBASE));
    assertEq(poolConfiguration.oracle(), address(fxUSDPriceOracle));
    assertTrue(poolConfiguration.hasRole(poolConfiguration.DEFAULT_ADMIN_ROLE(), admin));

    (uint128 borrowIndex, uint80 lastInterestRate, uint48 timestamp) = poolConfiguration.borrowRateSnapshot();
    assertEq(borrowIndex, 1e27);
    assertEq(lastInterestRate, 0.05 * 1e18);
    assertEq(timestamp, 1e9);

    // revert when initialize again
    vm.expectRevert(abi.encodeWithSelector(Initializable.InvalidInitialization.selector));
    poolConfiguration.initialize(admin, address(fxUSDPriceOracle));
  }

  function test_UpdatePoolFeeRatio(
    address recipient,
    uint256 supplyRatio,
    uint256 supplyRatioStep,
    uint256 withdrawFeeRatio,
    uint256 borrowFeeRatio,
    uint256 repayFeeRatio
  ) public {
    supplyRatio = bound(supplyRatio, 0, 1e9);
    supplyRatioStep = bound(supplyRatioStep, 1, 1e18);
    withdrawFeeRatio = bound(withdrawFeeRatio, 0, 1e9);
    borrowFeeRatio = bound(borrowFeeRatio, 0, 1e9);
    repayFeeRatio = bound(repayFeeRatio, 0, 1e9);

    // revert when not DEFAULT_ADMIN_ROLE
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        alice,
        poolConfiguration.DEFAULT_ADMIN_ROLE()
      )
    );
    vm.prank(alice);
    poolConfiguration.updatePoolFeeRatio(
      address(longPool),
      address(0),
      supplyRatio,
      supplyRatioStep,
      withdrawFeeRatio,
      borrowFeeRatio,
      repayFeeRatio
    );

    // revert when supplyRatio is too large
    vm.expectRevert(abi.encodeWithSelector(PoolConfiguration.ErrorValueTooLarge.selector));
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 1e9 + 1, 0, 0, 0, 0);

    // revert when supplyRatioStep is too large
    vm.expectRevert(abi.encodeWithSelector(PoolConfiguration.ErrorValueTooLarge.selector));
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 0, 1e18 + 1, 0, 0, 0);

    // revert when withdrawFeeRatio is too large
    vm.expectRevert(abi.encodeWithSelector(PoolConfiguration.ErrorValueTooLarge.selector));
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 0, 0, 1e9 + 1, 0, 0);

    // revert when borrowFeeRatio is too large
    vm.expectRevert(abi.encodeWithSelector(PoolConfiguration.ErrorValueTooLarge.selector));
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 0, 0, 0, 1e9 + 1, 0);

    // revert when repayFeeRatio is too large
    vm.expectRevert(abi.encodeWithSelector(PoolConfiguration.ErrorValueTooLarge.selector));
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 0, 0, 0, 0, 1e9 + 1);

    uint256 interestRate = poolConfiguration.getAverageInterestRate();
    uint256 supplyFeeRatio;
    unchecked {
      uint256 aaveRatio = interestRate <= supplyRatioStep ? 1 : (interestRate - 1) / supplyRatioStep;
      supplyFeeRatio = aaveRatio * supplyRatio;
    }

    // update default fee ratio to parameters
    vm.expectEmit(true, true, true, true);
    emit UpdatePoolFeeRatio(
      address(longPool),
      address(0),
      supplyRatio,
      supplyRatioStep,
      withdrawFeeRatio,
      borrowFeeRatio,
      repayFeeRatio
    );
    poolConfiguration.updatePoolFeeRatio(
      address(longPool),
      address(0),
      supplyRatio,
      supplyRatioStep,
      withdrawFeeRatio,
      borrowFeeRatio,
      repayFeeRatio
    );
    (
      uint256 actualSupplyFeeRatio,
      uint256 actualWithdrawFeeRatio,
      uint256 actualBorrowFeeRatio,
      uint256 actualRepayFeeRatio
    ) = poolConfiguration.getPoolFeeRatio(address(longPool), recipient);
    assertEq(actualSupplyFeeRatio, supplyFeeRatio);
    assertEq(actualWithdrawFeeRatio, withdrawFeeRatio);
    assertEq(actualBorrowFeeRatio, borrowFeeRatio);
    assertEq(actualRepayFeeRatio, repayFeeRatio);

    // update default fee ratio to 0
    vm.expectEmit(true, true, true, true);
    emit UpdatePoolFeeRatio(address(longPool), address(0), 0, supplyRatioStep, 0, 0, 0);
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 0, supplyRatioStep, 0, 0, 0);
    (actualSupplyFeeRatio, actualWithdrawFeeRatio, actualBorrowFeeRatio, actualRepayFeeRatio) = poolConfiguration
      .getPoolFeeRatio(address(longPool), recipient);
    assertEq(actualSupplyFeeRatio, 0);
    assertEq(actualWithdrawFeeRatio, 0);
    assertEq(actualBorrowFeeRatio, 0);
    assertEq(actualRepayFeeRatio, 0);

    // update custom fee ratio to parameters
    vm.expectEmit(true, true, true, true);
    emit UpdatePoolFeeRatio(
      address(longPool),
      recipient,
      supplyRatio,
      supplyRatioStep,
      withdrawFeeRatio,
      borrowFeeRatio,
      repayFeeRatio
    );
    poolConfiguration.updatePoolFeeRatio(
      address(longPool),
      recipient,
      supplyRatio,
      supplyRatioStep,
      withdrawFeeRatio,
      borrowFeeRatio,
      repayFeeRatio
    );
    (actualSupplyFeeRatio, actualWithdrawFeeRatio, actualBorrowFeeRatio, actualRepayFeeRatio) = poolConfiguration
      .getPoolFeeRatio(address(longPool), recipient);
    assertEq(actualSupplyFeeRatio, supplyFeeRatio);
    assertEq(actualWithdrawFeeRatio, withdrawFeeRatio);
    assertEq(actualBorrowFeeRatio, borrowFeeRatio);
    assertEq(actualRepayFeeRatio, repayFeeRatio);
  }

  function test_UpdateLongFundingRatioParameter(uint64 scalarA, uint64 scalarB, uint64 maxFxUSDRatio) public {
    maxFxUSDRatio = uint64(bound(maxFxUSDRatio, 0, 1e18));
    // revert when not DEFAULT_ADMIN_ROLE
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        alice,
        poolConfiguration.DEFAULT_ADMIN_ROLE()
      )
    );
    vm.prank(alice);
    poolConfiguration.updateLongFundingRatioParameter(address(longPool), scalarA, scalarB, maxFxUSDRatio);

    // update successfully
    vm.expectEmit(true, true, true, true);
    emit UpdateLongFundingRatioParameter(scalarA, scalarB, maxFxUSDRatio);
    poolConfiguration.updateLongFundingRatioParameter(address(longPool), scalarA, scalarB, maxFxUSDRatio);

    // test when isPriceBelowMaxDeviation
    mockCurveStableSwapNG.setPriceOracle(0, 0.9e18);
    assertTrue(fxUSDPriceOracle.isPriceBelowMaxDeviation());
    uint256 interestRate = poolConfiguration.getAverageInterestRate();
    uint256 fundingRatio = poolConfiguration.getLongPoolFundingRatio(address(longPool));
    assertEq(fundingRatio, (interestRate * scalarB) / 1e18);

    // price is normal now
    mockCurveStableSwapNG.setPriceOracle(0, 1e18);
    assertFalse(fxUSDPriceOracle.isPriceBelowMaxDeviation());

    // test no fxUSD or USDC in FxBasePool
    fundingRatio = poolConfiguration.getLongPoolFundingRatio(address(longPool));
    assertEq(fundingRatio, (interestRate * scalarA) / 1e18);

    // test only USDC in FxBasePool, maxFxUSDRatio = 10%
    poolConfiguration.updateLongFundingRatioParameter(address(longPool), scalarA, scalarB, 1e17);
    stableToken.mint(address(this), 1e6);
    stableToken.approve(address(fxBASE), 1e6);
    fxBASE.deposit(address(this), address(stableToken), 1e6, 0);
    fundingRatio = poolConfiguration.getLongPoolFundingRatio(address(longPool));
    assertEq(fundingRatio, 0);

    fxBASE.instantRedeem(address(this), 1e18);
    assertEq(fxBASE.totalStableToken(), 0);
    assertEq(fxBASE.totalYieldToken(), 0);
  }

  function test_UpdateShortFundingRatioParameter(uint64 scalarC, uint64 maxBorrowRatio) public {
    maxBorrowRatio = uint64(bound(maxBorrowRatio, 1, 1e18));
    // revert when not DEFAULT_ADMIN_ROLE
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        alice,
        poolConfiguration.DEFAULT_ADMIN_ROLE()
      )
    );
    vm.prank(alice);
    poolConfiguration.updateShortFundingRatioParameter(address(shortPool), scalarC, maxBorrowRatio);

    // update successfully
    vm.expectEmit(true, true, true, true);
    emit UpdateShortFundingRatioParameter(scalarC, maxBorrowRatio);
    poolConfiguration.updateShortFundingRatioParameter(address(shortPool), scalarC, maxBorrowRatio);

    // test when debt ratio is below max borrow ratio
    uint256 fundingRatio = poolConfiguration.getShortPoolFundingRatio(address(shortPool));
    assertEq(fundingRatio, 0);

    // test when debt ratio is above max borrow ratio
    poolConfiguration.updateShortFundingRatioParameter(address(shortPool), scalarC, 0);
    uint256 interestRate = poolConfiguration.getAverageInterestRate();
    fundingRatio = poolConfiguration.getShortPoolFundingRatio(address(shortPool));
    assertEq(fundingRatio, (interestRate * scalarC) / 1e18);
  }

  function test_UpdateOracle() public {
    // revert when not DEFAULT_ADMIN_ROLE
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        alice,
        poolConfiguration.DEFAULT_ADMIN_ROLE()
      )
    );
    vm.prank(alice);
    poolConfiguration.updateOracle(address(fxUSDPriceOracle));

    MockPriceOracle newOracle = new MockPriceOracle(3000 ether, 2999 ether, 3001 ether);
    vm.expectEmit(true, true, true, true);
    emit UpdateOracle(address(fxUSDPriceOracle), address(newOracle));
    poolConfiguration.updateOracle(address(newOracle));
    assertEq(poolConfiguration.oracle(), address(newOracle));
  }

  function test_Checkpoint() public {
    // revert when pool invalid
    vm.expectRevert(abi.encodeWithSelector(PoolConfiguration.ErrorInvalidPool.selector));
    poolConfiguration.checkpoint(address(0));
    vm.expectRevert(abi.encodeWithSelector(PoolConfiguration.ErrorInvalidPool.selector));
    poolConfiguration.checkpoint(address(this));

    // First update the pool fee ratio to make the pool valid
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 0.1e9, 0.01e18, 0.05e9, 0.02e9, 0.03e9);

    // no update when duration < 30 minutes
    vm.warp(1e9 + 30 minutes - 1);
    vm.prank(address(longPool));
    poolConfiguration.checkpoint(address(longPool));
    (, , uint48 timestamp) = poolConfiguration.borrowRateSnapshot();
    assertEq(timestamp, 1e9);

    vm.warp(1e9 + 30 minutes);
    vm.prank(address(longPool));
    vm.expectEmit(true, true, true, true);
    emit Snapshot(1e27, 0.05e18, 1e9 + 30 minutes);
    poolConfiguration.checkpoint(address(longPool));
    (, , timestamp) = poolConfiguration.borrowRateSnapshot();
    assertEq(timestamp, 1e9 + 30 minutes);
  }

  function test_IsBorrowAllowed() public {
    // normal price
    mockCurveStableSwapNG.setPriceOracle(0, 1e18);
    assertTrue(poolConfiguration.isBorrowAllowed());

    // above max deviation
    mockCurveStableSwapNG.setPriceOracle(0, 1.1e18);
    assertTrue(poolConfiguration.isBorrowAllowed());

    // below max deviation
    mockCurveStableSwapNG.setPriceOracle(0, 0.9e18);
    assertFalse(poolConfiguration.isBorrowAllowed());
  }

  function test_IsFundingEnabled() public {
    // normal price
    mockCurveStableSwapNG.setPriceOracle(0, 1e18);
    assertFalse(poolConfiguration.isFundingEnabled());

    // above max deviation
    mockCurveStableSwapNG.setPriceOracle(0, 1.1e18);
    assertFalse(poolConfiguration.isFundingEnabled());

    // below max deviation
    mockCurveStableSwapNG.setPriceOracle(0, 0.9e18);
    assertTrue(poolConfiguration.isFundingEnabled());
  }

  function test_IsStableRepayAllowed() public {
    // normal price
    mockCurveStableSwapNG.setPriceOracle(0, 1e18);
    assertFalse(poolConfiguration.isStableRepayAllowed());

    // above max deviation
    mockCurveStableSwapNG.setPriceOracle(0, 1.1e18);
    assertTrue(poolConfiguration.isStableRepayAllowed());

    // below max deviation
    mockCurveStableSwapNG.setPriceOracle(0, 0.9e18);
    assertFalse(poolConfiguration.isStableRepayAllowed());
  }

  function test_StableDepegPrice() public {
    // Test initial value
    assertEq(poolConfiguration.stableDepegPrice(), 0);

    // Test revert when not admin
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        alice,
        poolConfiguration.DEFAULT_ADMIN_ROLE()
      )
    );
    vm.prank(alice);
    poolConfiguration.updateStableDepegPrice(0.99e18);

    // Test update by admin
    vm.expectEmit(true, true, true, true);
    emit UpdateStableDepegPrice(0, 0.98e18);
    poolConfiguration.updateStableDepegPrice(0.98e18);
    assertEq(poolConfiguration.stableDepegPrice(), 0.98e18);

    // Test isStableRepayAllowed with different stable token prices
    // Case 1: Price above max deviation and stable price above depeg threshold
    mockCurveStableSwapNG.setPriceOracle(0, 1.1e18); // Above max deviation
    assertTrue(fxUSDPriceOracle.isPriceAboveMaxDeviation());
    mockAggregatorV3Interface.setPrice(0.99e8); // Stable price above depeg threshold
    assertTrue(poolConfiguration.isStableRepayAllowed());

    // Case 2: Price above max deviation but stable price below depeg threshold
    mockCurveStableSwapNG.setPriceOracle(0, 1.1e18); // Above max deviation
    assertTrue(fxUSDPriceOracle.isPriceAboveMaxDeviation());
    mockAggregatorV3Interface.setPrice(0.94e8); // Stable price below depeg threshold
    assertFalse(poolConfiguration.isStableRepayAllowed());

    // Case 3: Price below max deviation and stable price above depeg threshold
    mockCurveStableSwapNG.setPriceOracle(0, 0.9e18); // Below max deviation
    assertFalse(fxUSDPriceOracle.isPriceAboveMaxDeviation());
    mockAggregatorV3Interface.setPrice(0.99e8); // Stable price above depeg threshold
    assertFalse(poolConfiguration.isStableRepayAllowed());

    // Case 4: Price below max deviation and stable price below depeg threshold
    mockCurveStableSwapNG.setPriceOracle(0, 0.9e18); // Below max deviation
    assertFalse(fxUSDPriceOracle.isPriceAboveMaxDeviation());
    mockAggregatorV3Interface.setPrice(0.94e8); // Stable price below depeg threshold
    assertFalse(poolConfiguration.isStableRepayAllowed());
  }

  function test_Lock() public {
    this._testLockInternal();
  }

  function _testLockInternal() public {
    // Test lock when not locked
    poolConfiguration.lock(address(this), msg.sig);

    // Test lock when locked
    vm.expectRevert(abi.encodeWithSelector(PoolConfiguration.ErrorPoolManagerLocked.selector));
    poolConfiguration.lock(address(this), msg.sig);
  }
}
