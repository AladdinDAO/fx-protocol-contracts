// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { console } from "forge-std/console.sol";

import { PoolTestBase } from "../../../test/foundry/PoolTestBase.s.sol";

contract ShortPoolManagerTest is PoolTestBase {
  function setUp() public {
    __PoolTestBase_setUp(1.23 ether, 18);

    // open a long position
    longPool.updateDebtRatioRange(0, 1e18);
    longPool.updateRebalanceRatios(0.88 ether, 5e7);
    longPool.updateLiquidateRatios(0.92 ether, 5e7);
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 0, 1e18, 0, 0, 0);
    collateralToken.mint(address(this), 100 ether);
    collateralToken.approve(address(poolManager), 100 ether);
    poolManager.operate(address(longPool), 0, 100 ether, 200000 ether);
  }

  function test_Operate() public {
    poolManager.updateShortBorrowCapacityRatio(address(longPool), 1e18);

    // open a short position
    shortPool.updateDebtRatioRange(0, 1e18);
    shortPool.updateRebalanceRatios(0.88 ether, 5e7);
    shortPool.updateLiquidateRatios(0.92 ether, 5e7);
    poolConfiguration.updatePoolFeeRatio(address(shortPool), address(0), 1e7, 1e18, 2e7, 3e7, 4e7);
    (
      uint256 actualSupplyFeeRatio,
      uint256 actualWithdrawFeeRatio,
      uint256 actualBorrowFeeRatio,
      uint256 actualRepayFeeRatio
    ) = poolConfiguration.getPoolFeeRatio(address(shortPool), address(this));
    assertEq(actualSupplyFeeRatio, 1e7);
    assertEq(actualWithdrawFeeRatio, 2e7);
    assertEq(actualBorrowFeeRatio, 3e7);
    assertEq(actualRepayFeeRatio, 4e7);

    // ETH price is 3000
    mockShortPriceOracle.setPrices(333333333333333, 333333333333333, 333333333333333);

    // use 10000 fxUSD borrow 1 wstETH
    fxUSD.approve(address(shortPoolManager), 10000 ether);
    assertEq(fxUSD.balanceOf(address(this)), 200000 ether);
    assertEq(collateralToken.balanceOf(address(this)), 0);
    assertEq(creditNote.totalSupply(), 0);
    uint256 positionId = shortPoolManager.operate(address(shortPool), 0, 10000 ether, 1 ether);
    assertEq(positionId, 1);
    assertEq(fxUSD.balanceOf(address(this)), 190000 ether);
    assertEq(fxUSD.balanceOf(address(shortPoolManager)), 10000 ether);
    assertEq(creditNote.totalSupply(), 1 ether);
    assertEq(collateralToken.balanceOf(address(this)), 0.97 ether);
    assertEq(collateralToken.balanceOf(address(openRevenuePool)), 0.03 ether);
    assertEq(shortPoolManager.accumulatedPoolOpenFees(address(shortPool)), 100 ether);
    (, uint256 collateralBalance, , uint256 debtBalance) = shortPoolManager.getPoolInfo(address(shortPool));
    assertEq(collateralBalance, 9900 ether);
    assertEq(debtBalance, 1 ether);
    (uint256 rawColls, uint256 rawDebts) = shortPool.getPosition(positionId);
    assertEq(rawColls, 9900 ether);
    assertEq(rawDebts, 1 ether);

    // repay 0.1 wstETH, get 100 fxUSD
    collateralToken.approve(address(shortPoolManager), 0.1 ether + 0.004 ether);
    shortPoolManager.operate(address(shortPool), positionId, -100 ether, -0.1 ether);
    assertEq(fxUSD.balanceOf(address(this)), 190098 ether);
    assertEq(fxUSD.balanceOf(address(shortPoolManager)), 9902 ether);
    assertEq(collateralToken.balanceOf(address(this)), 0.866 ether);
    assertEq(collateralToken.balanceOf(address(closeRevenuePool)), 0.004 ether);
    assertEq(shortPoolManager.accumulatedPoolCloseFees(address(shortPool)), 2 ether);
    (, collateralBalance, , debtBalance) = shortPoolManager.getPoolInfo(address(shortPool));
    assertEq(collateralBalance, 9800 ether);
    assertEq(debtBalance, 0.9 ether);
    (rawColls, rawDebts) = shortPool.getPosition(positionId);
    assertEq(rawColls, 9800 ether);
    assertEq(rawDebts, 0.9 ether);

    // withdraw fees
    address[] memory pools = new address[](1);
    pools[0] = address(shortPool);
    shortPoolManager.withdrawAccumulatedPoolFee(pools);
    assertEq(shortPoolManager.accumulatedPoolMiscFees(address(shortPool)), 0 ether);
    assertEq(shortPoolManager.accumulatedPoolOpenFees(address(shortPool)), 0 ether);
    assertEq(shortPoolManager.accumulatedPoolCloseFees(address(shortPool)), 0 ether);
    assertEq(fxUSD.balanceOf(address(openRevenuePool)), 100 ether);
    assertEq(fxUSD.balanceOf(address(closeRevenuePool)), 2 ether);
  }
}

contract ShortPoolManagerTestDecimal8 is PoolTestBase {
  uint256 private constant TOKEN_SCALE = 100000000;

  function setUp() public {
    __PoolTestBase_setUp(1 ether, 8);

    // open a long position
    longPool.updateDebtRatioRange(0, 1e18);
    longPool.updateRebalanceRatios(0.88 ether, 5e7);
    longPool.updateLiquidateRatios(0.92 ether, 5e7);
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 0, 1e18, 0, 0, 0);
    collateralToken.mint(address(this), 100 * TOKEN_SCALE);
    collateralToken.approve(address(poolManager), 100 * TOKEN_SCALE);
    poolManager.operate(address(longPool), 0, int256(100 * TOKEN_SCALE), 200000 ether);
  }

  function test_Operate() public {
    poolManager.updateShortBorrowCapacityRatio(address(longPool), 1e18);

    // open a short position
    shortPool.updateDebtRatioRange(0, 1e18);
    shortPool.updateRebalanceRatios(0.88 ether, 5e7);
    shortPool.updateLiquidateRatios(0.92 ether, 5e7);
    poolConfiguration.updatePoolFeeRatio(address(shortPool), address(0), 1e7, 1e18, 2e7, 3e7, 4e7);
    (
      uint256 actualSupplyFeeRatio,
      uint256 actualWithdrawFeeRatio,
      uint256 actualBorrowFeeRatio,
      uint256 actualRepayFeeRatio
    ) = poolConfiguration.getPoolFeeRatio(address(shortPool), address(this));
    assertEq(actualSupplyFeeRatio, 1e7);
    assertEq(actualWithdrawFeeRatio, 2e7);
    assertEq(actualBorrowFeeRatio, 3e7);
    assertEq(actualRepayFeeRatio, 4e7);

    // WBTC price is 3000
    mockShortPriceOracle.setPrices(333333333333333, 333333333333333, 333333333333333);

    // use 10000 fxUSD borrow 1 WBTC
    fxUSD.approve(address(shortPoolManager), 10000 ether);
    assertEq(fxUSD.balanceOf(address(this)), 200000 ether);
    assertEq(collateralToken.balanceOf(address(this)), 0);
    assertEq(creditNote.totalSupply(), 0);
    uint256 positionId = shortPoolManager.operate(address(shortPool), 0, 10000 ether, int256(1 * TOKEN_SCALE));
    assertEq(positionId, 1);
    assertEq(fxUSD.balanceOf(address(this)), 190000 ether);
    assertEq(fxUSD.balanceOf(address(shortPoolManager)), 10000 ether);
    assertEq(creditNote.totalSupply(), 1 * TOKEN_SCALE);
    assertEq(collateralToken.balanceOf(address(this)), (TOKEN_SCALE * 97) / 100);
    assertEq(collateralToken.balanceOf(address(openRevenuePool)), (TOKEN_SCALE * 3) / 100);
    assertEq(shortPoolManager.accumulatedPoolOpenFees(address(shortPool)), 100 ether);
    (, uint256 collateralBalance, , uint256 debtBalance) = shortPoolManager.getPoolInfo(address(shortPool));
    assertEq(collateralBalance, 9900 ether);
    assertEq(debtBalance, 1 ether);
    (uint256 rawColls, uint256 rawDebts) = shortPool.getPosition(positionId);
    assertEq(rawColls, 9900 ether);
    assertEq(rawDebts, 1 ether);

    // repay 0.1 WBTC, get 100 fxUSD
    collateralToken.approve(address(shortPoolManager), TOKEN_SCALE / 10 + (TOKEN_SCALE * 4) / 1000);
    shortPoolManager.operate(address(shortPool), positionId, -100 ether, -int256(TOKEN_SCALE / 10));
    assertEq(fxUSD.balanceOf(address(this)), 190098 ether);
    assertEq(fxUSD.balanceOf(address(shortPoolManager)), 9902 ether);
    assertEq(collateralToken.balanceOf(address(this)), (TOKEN_SCALE * 866) / 1000);
    assertEq(collateralToken.balanceOf(address(closeRevenuePool)), (TOKEN_SCALE * 4) / 1000);
    assertEq(shortPoolManager.accumulatedPoolCloseFees(address(shortPool)), 2 ether);
    (, collateralBalance, , debtBalance) = shortPoolManager.getPoolInfo(address(shortPool));
    assertEq(collateralBalance, 9800 ether);
    assertEq(debtBalance, 0.9 ether);
    (rawColls, rawDebts) = shortPool.getPosition(positionId);
    assertEq(rawColls, 9800 ether);
    assertEq(rawDebts, 0.9 ether);

    // withdraw fees
    address[] memory pools = new address[](1);
    pools[0] = address(shortPool);
    shortPoolManager.withdrawAccumulatedPoolFee(pools);
    assertEq(shortPoolManager.accumulatedPoolMiscFees(address(shortPool)), 0 ether);
    assertEq(shortPoolManager.accumulatedPoolOpenFees(address(shortPool)), 0 ether);
    assertEq(shortPoolManager.accumulatedPoolCloseFees(address(shortPool)), 0 ether);
    assertEq(fxUSD.balanceOf(address(openRevenuePool)), 100 ether);
    assertEq(fxUSD.balanceOf(address(closeRevenuePool)), 2 ether);
  }
}
