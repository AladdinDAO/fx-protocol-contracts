// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { PoolTestBase } from "./PoolTestBase.s.sol";
import { FxUSDPriceOracle } from "../../contracts/core/FxUSDPriceOracle.sol";
import { MockCurveStableSwapNG } from "../../contracts/mocks/MockCurveStableSwapNG.sol";

contract FxUSDPriceOracleTest is PoolTestBase {
  event UpdateCurvePool(address indexed oldPool, address indexed newPool);
  event UpdateMaxPriceDeviation(
    uint256 oldDePegDeviation,
    uint256 oldUpPegDeviation,
    uint256 newDePegDeviation,
    uint256 newUpPegDeviation
  );

  address alice = makeAddr("alice");
  MockCurveStableSwapNG newCurvePool;

  function setUp() public {
    vm.warp(1e9);
    __PoolTestBase_setUp(1e18, 18);
    newCurvePool = new MockCurveStableSwapNG();
  }

  function test_Initialize() public {
    assertEq(fxUSDPriceOracle.fxUSD(), address(fxUSD));
    assertEq(fxUSDPriceOracle.curvePool(), address(mockCurveStableSwapNG));
    assertTrue(fxUSDPriceOracle.hasRole(fxUSDPriceOracle.DEFAULT_ADMIN_ROLE(), admin));

    // revert when initialize again
    vm.expectRevert(abi.encodeWithSelector(Initializable.InvalidInitialization.selector));
    fxUSDPriceOracle.initialize(admin, address(mockCurveStableSwapNG));
  }

  function test_GetPrice() public {
    // Test when price is pegged
    mockCurveStableSwapNG.setPriceOracle(0, 1e18);
    (bool isPegged, uint256 price) = fxUSDPriceOracle.getPrice();
    assertTrue(isPegged);
    assertEq(price, 1e18);

    // Test when price is above max deviation
    mockCurveStableSwapNG.setPriceOracle(0, 1.1e18);
    (isPegged, price) = fxUSDPriceOracle.getPrice();
    assertFalse(isPegged);
    assertEq(price, 1.1e18);

    // Test when price is below max deviation
    mockCurveStableSwapNG.setPriceOracle(0, 0.9e18);
    (isPegged, price) = fxUSDPriceOracle.getPrice();
    assertFalse(isPegged);
    assertEq(price, 0.9e18);

    // Test when fxUSD is first coin
    mockCurveStableSwapNG.setCoin(0, address(fxUSD));
    mockCurveStableSwapNG.setPriceOracle(0, 1.1e18);
    (isPegged, price) = fxUSDPriceOracle.getPrice();
    assertFalse(isPegged);
    assertEq(price, 909090909090909090);
  }

  function test_IsPriceAboveMaxDeviation() public {
    // Test when price is pegged
    mockCurveStableSwapNG.setPriceOracle(0, 1e18);
    assertFalse(fxUSDPriceOracle.isPriceAboveMaxDeviation());

    // Test when price is above max deviation
    mockCurveStableSwapNG.setPriceOracle(0, 1.1e18);
    assertTrue(fxUSDPriceOracle.isPriceAboveMaxDeviation());

    // Test when price is below max deviation
    mockCurveStableSwapNG.setPriceOracle(0, 0.9e18);
    assertFalse(fxUSDPriceOracle.isPriceAboveMaxDeviation());
  }

  function test_IsPriceBelowMaxDeviation() public {
    // Test when price is pegged
    mockCurveStableSwapNG.setPriceOracle(0, 1e18);
    assertFalse(fxUSDPriceOracle.isPriceBelowMaxDeviation());

    // Test when price is above max deviation
    mockCurveStableSwapNG.setPriceOracle(0, 1.1e18);
    assertFalse(fxUSDPriceOracle.isPriceBelowMaxDeviation());

    // Test when price is below max deviation
    mockCurveStableSwapNG.setPriceOracle(0, 0.9e18);
    assertTrue(fxUSDPriceOracle.isPriceBelowMaxDeviation());
  }

  function test_UpdateCurvePool() public {
    // revert when not DEFAULT_ADMIN_ROLE
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        alice,
        fxUSDPriceOracle.DEFAULT_ADMIN_ROLE()
      )
    );
    vm.prank(alice);
    fxUSDPriceOracle.updateCurvePool(address(newCurvePool));

    // revert when new pool is zero address
    vm.expectRevert(abi.encodeWithSelector(FxUSDPriceOracle.ErrorZeroAddress.selector));
    fxUSDPriceOracle.updateCurvePool(address(0));

    // update curve pool
    vm.expectEmit(true, true, true, true);
    emit UpdateCurvePool(address(mockCurveStableSwapNG), address(newCurvePool));
    fxUSDPriceOracle.updateCurvePool(address(newCurvePool));
    assertEq(fxUSDPriceOracle.curvePool(), address(newCurvePool));
  }

  function test_UpdateMaxPriceDeviation() public {
    // revert when not DEFAULT_ADMIN_ROLE
    vm.expectRevert(
      abi.encodeWithSelector(
        IAccessControl.AccessControlUnauthorizedAccount.selector,
        alice,
        fxUSDPriceOracle.DEFAULT_ADMIN_ROLE()
      )
    );
    vm.prank(alice);
    fxUSDPriceOracle.updateMaxPriceDeviation(0.1e18, 0.2e18);

    // update max price deviation
    vm.expectEmit(true, true, true, true);
    emit UpdateMaxPriceDeviation(0, 0, 0.1e18, 0.2e18);
    fxUSDPriceOracle.updateMaxPriceDeviation(0.1e18, 0.2e18);
    assertEq(fxUSDPriceOracle.maxDePegPriceDeviation(), 0.1e18);
    assertEq(fxUSDPriceOracle.maxUpPegPriceDeviation(), 0.2e18);

    // Test price deviation effects

    mockCurveStableSwapNG.setPriceOracle(0, 0.9e18);
    assertFalse(fxUSDPriceOracle.isPriceBelowMaxDeviation());
    (bool isPegged, ) = fxUSDPriceOracle.getPrice();
    assertTrue(isPegged);

    mockCurveStableSwapNG.setPriceOracle(0, 0.9e18 - 1);
    assertTrue(fxUSDPriceOracle.isPriceBelowMaxDeviation());
    (isPegged, ) = fxUSDPriceOracle.getPrice();
    assertFalse(isPegged);

    mockCurveStableSwapNG.setPriceOracle(0, 1.2e18);
    assertFalse(fxUSDPriceOracle.isPriceAboveMaxDeviation());
    (isPegged, ) = fxUSDPriceOracle.getPrice();
    assertTrue(isPegged);

    mockCurveStableSwapNG.setPriceOracle(0, 1.2e18 + 1);
    assertTrue(fxUSDPriceOracle.isPriceAboveMaxDeviation());
    (isPegged, ) = fxUSDPriceOracle.getPrice();
    assertFalse(isPegged);
  }
}
