// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { console } from "forge-std/console.sol";

import { PoolTestBase } from "../../test/foundry/PoolTestBase.s.sol";

contract PoolManagerTest is PoolTestBase {
  function setUp() public {
    __PoolTestBase_setUp(1.23 ether, 18);
  }

  function test_Operate() public {
    longPool.updateDebtRatioRange(0, 1e18);
    longPool.updateRebalanceRatios(0.88 ether, 5e7);
    longPool.updateLiquidateRatios(0.92 ether, 5e7);
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 1e7, 1e18, 2e7, 3e7, 4e7);
    (
      uint256 actualSupplyFeeRatio,
      uint256 actualWithdrawFeeRatio,
      uint256 actualBorrowFeeRatio,
      uint256 actualRepayFeeRatio
    ) = poolConfiguration.getPoolFeeRatio(address(longPool), address(this));
    assertEq(actualSupplyFeeRatio, 1e7);
    assertEq(actualWithdrawFeeRatio, 2e7);
    assertEq(actualBorrowFeeRatio, 3e7);
    assertEq(actualRepayFeeRatio, 4e7);

    // open a new position, charge supply and borrow fees
    collateralToken.mint(address(this), 1 ether);
    collateralToken.approve(address(poolManager), 1 ether);

    assertEq(collateralToken.balanceOf(address(this)), 1 ether);
    assertEq(collateralToken.balanceOf(address(poolManager)), 0);
    assertEq(fxUSD.balanceOf(address(this)), 0);
    uint256 positionId = poolManager.operate(address(longPool), 0, 1 ether, 2000 ether);
    assertEq(positionId, 1);
    assertEq(collateralToken.balanceOf(address(this)), 0);
    assertEq(collateralToken.balanceOf(address(poolManager)), 1 ether);
    assertEq(fxUSD.balanceOf(address(this)), 1940 ether);
    assertEq(fxUSD.balanceOf(address(openRevenuePool)), 60 ether);
    assertEq(poolManager.accumulatedPoolOpenFees(address(longPool)), 0.01 ether);
    (, uint256 collateralBalance, uint256 rawCollateral, , uint256 debtBalance) = poolManager.getPoolInfo(
      address(longPool)
    );
    assertApproxEqAbs(collateralBalance, 0.99 ether, 100);
    assertEq(rawCollateral, 1.2177 ether);
    assertEq(debtBalance, 2000 ether);
    (uint256 rawColls, uint256 rawDebts) = longPool.getPosition(positionId);
    assertEq(rawColls, 1.2177 ether);
    assertEq(rawDebts, 2000 ether);

    // close the position, charge withdraw and repay fees
    poolManager.operate(address(longPool), positionId, -0.1 ether, -200 ether);
    assertEq(collateralToken.balanceOf(address(this)), 0.098 ether);
    assertEq(collateralToken.balanceOf(address(poolManager)), 0.902 ether);
    assertEq(fxUSD.balanceOf(address(this)), 1732 ether);
    assertEq(fxUSD.balanceOf(address(closeRevenuePool)), 8 ether);
    assertEq(poolManager.accumulatedPoolCloseFees(address(longPool)), 0.002 ether);
    (, collateralBalance, rawCollateral, , debtBalance) = poolManager.getPoolInfo(address(longPool));
    assertApproxEqAbs(collateralBalance, 0.89 ether, 100);
    assertEq(rawCollateral, 1.0947 ether);
    assertEq(debtBalance, 1800 ether);
    (rawColls, rawDebts) = longPool.getPosition(positionId);
    assertEq(rawColls, 1.0947 ether);
    assertEq(rawDebts, 1800 ether);
  }
}
