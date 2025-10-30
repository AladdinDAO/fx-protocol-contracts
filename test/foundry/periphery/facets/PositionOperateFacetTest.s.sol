// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { MultiPathConverter } from "../../../../contracts/helpers/converter/MultiPathConverter.sol";
import { PositionOperateFacet } from "../../../../contracts/periphery/facets/PositionOperateFacet.sol";
import { LibRouter } from "../../../../contracts/periphery/libraries/LibRouter.sol";
import { ILongPool } from "../../../../contracts/interfaces/ILongPool.sol";
import { ILongPoolManager } from "../../../../contracts/interfaces/ILongPoolManager.sol";

import { PoolManager } from "../../../../contracts/core/PoolManager.sol";

import { ForkBase } from "../../ForkBase.s.sol";

contract PositionOperateFacetTest is ForkBase {
  string private MAINNET_FORK_RPC = vm.envString("MAINNET_FORK_RPC");

  // Test accounts
  address private user;
  address private whale;

  // Test data
  uint256 private constant FORK_BLOCK = 23645330; // Recent mainnet block
  uint256 private constant INITIAL_BALANCE = 1000 ether;

  function setUp() public {
    // Set up test accounts
    user = makeAddr("user");
    whale = makeAddr("whale");

    // Deploy and upgrade the facet
    PositionOperateFacet facet = new PositionOperateFacet();
    upgradeFacet(PositionOperateFacet.borrowFromLong.selector, address(facet));
    upgradeFacet(PositionOperateFacet.repayToLong.selector, address(facet));

    // Fund test accounts with ETH
    vm.deal(user, INITIAL_BALANCE);
    vm.deal(whale, INITIAL_BALANCE);

    // Fund whale with various tokens for testing
    _fundWhaleWithTokens();

    // Fund user with some tokens for basic operations
    _fundUserWithTokens();

    // upgrade long pool manager
    PoolManager impl = new PoolManager(
        address(fxUSD),
        address(fxBASE),
        address(shortPoolManager),
        address(configuration),
        address(0)
    );
    upgradeProxy(address(longPoolManager), address(impl));

    // update pool fee ratio for DiamondRouter
    vm.prank(FxMultisig);
    configuration.updatePoolFeeRatio(address(wstETHLongPool), address(DiamondRouter), 1e7, 1e18, 2e7, 3e7, 4e7);
  }

  function _fundWhaleWithTokens() internal {
    // Fund whale with wstETH
    vm.prank(0x5313b39bf226ced2332C81eB97BB28c6fD50d1a3); // wstETH whale
    IERC20(wstETH).transfer(whale, 10000 * 1e18); // 10K wstETH

    // Fund whale with stETH
    vm.prank(0x176F3DAb24a159341c0509bB36B833E7fdd0a132); // stETH whale
    IERC20(stETH).transfer(whale, 10000 * 1e18); // 10K stETH

    // Fund whale with fxUSD
    vm.prank(0x1C5606e7dE910B24E63686972db62c2129A8A488); // fxUSD whale
    IERC20(address(fxUSD)).transfer(whale, 10000 * 1e18); // 10K fxUSD
  }

  function _fundUserWithTokens() internal {
    vm.startPrank(whale);
    IERC20(wstETH).transfer(user, 10 ether); // 10 WETH
    IERC20(stETH).transfer(user, 10 ether); // 10 stETH
    IERC20(address(fxUSD)).transfer(user, 10000 * 1e18); // 10K fxUSD
    vm.stopPrank();
  }

  function _createTestPosition() internal returns (uint256) {
    vm.startPrank(user);
    IERC20(wstETH).approve(address(longPoolManager), 1 ether);
    uint256 positionId = longPoolManager.operate(address(wstETHLongPool), 0, 1 ether, 2000 ether);
    vm.stopPrank();

    return positionId;
  }

  function testBorrowFromLongWithStETH() public {
    // Test borrowing with stETH when positionId = 0 (new position)
    uint256 borrowAmount = 1000 ether; // 1000 fxUSD
    uint256 stETHAmount = 0.5 ether; // 0.5 stETH

    // Record initial balances
    uint256 initialStETHBalance = IERC20(stETH).balanceOf(user);
    uint256 initialFxUSDBalance = IERC20(address(fxUSD)).balanceOf(user);
    uint256 initialNFTBalance = IERC721(address(wstETHLongPool)).balanceOf(user);

    // Create ConvertInParams for stETH to wstETH conversion
    uint256[] memory routes = new uint256[](1);
    routes[0] = encodePoolHintV3Lido(address(wstETH), 1);
    LibRouter.ConvertInParams memory convertInParams = LibRouter.ConvertInParams({
      tokenIn: stETH,
      amount: stETHAmount,
      target: ConverterAddress, // Direct transfer, no conversion needed for this test
      data: abi.encodeCall(MultiPathConverter.convert, (stETH, stETHAmount, (1 << 20) | 0xfffff, routes)),
      minOut: 0,
      signature: ""
    });

    // Create BorrowFromLongParams
    PositionOperateFacet.BorrowFromLongParams memory borrowParams = PositionOperateFacet.BorrowFromLongParams({
      pool: address(wstETHLongPool),
      positionId: 0, // New position
      borrowAmount: borrowAmount
    });

    vm.startPrank(user);
    IERC20(stETH).approve(address(DiamondRouter), stETHAmount);
    uint256 positionId = PositionOperateFacet(DiamondRouter).borrowFromLong(convertInParams, borrowParams);
    vm.stopPrank();

    // Verify position was created
    assertTrue(positionId > 0, "Position should be created");

    // Verify NFT was transferred back to user
    assertEq(IERC721(address(wstETHLongPool)).balanceOf(user), initialNFTBalance + 1, "NFT should be transferred back to user");
    assertEq(IERC721(address(wstETHLongPool)).ownerOf(positionId), user, "User should own the NFT");

    // Verify fxUSD was received
    assertGt(IERC20(address(fxUSD)).balanceOf(user), initialFxUSDBalance, "User should receive fxUSD");

    // Verify stETH was used
    assertLt(IERC20(stETH).balanceOf(user), initialStETHBalance, "User stETH balance should decrease");
  }

  function testBorrowFromLongWithWstETH() public {
    // Test borrowing with wstETH when positionId = 0 (new position)
    uint256 borrowAmount = 1000 ether; // 1000 fxUSD
    uint256 wstETHAmount = 0.5 ether; // 0.5 wstETH

    // Record initial balances
    uint256 initialWstETHBalance = IERC20(wstETH).balanceOf(user);
    uint256 initialFxUSDBalance = IERC20(address(fxUSD)).balanceOf(user);
    uint256 initialNFTBalance = IERC721(address(wstETHLongPool)).balanceOf(user);

    // Create ConvertInParams for wstETH (no conversion needed)
    LibRouter.ConvertInParams memory convertInParams = LibRouter.ConvertInParams({
      tokenIn: wstETH,
      amount: wstETHAmount,
      target: ConverterAddress, // Direct transfer, no conversion needed
      data: "",
      minOut: 0,
      signature: ""
    });

    // Create BorrowFromLongParams
    PositionOperateFacet.BorrowFromLongParams memory borrowParams = PositionOperateFacet.BorrowFromLongParams({
      pool: address(wstETHLongPool),
      positionId: 0, // New position
      borrowAmount: borrowAmount
    });

    vm.startPrank(user);
    IERC20(wstETH).approve(address(DiamondRouter), wstETHAmount);
    uint256 positionId = PositionOperateFacet(DiamondRouter).borrowFromLong(convertInParams, borrowParams);
    vm.stopPrank();

    // Verify position was created
    assertTrue(positionId > 0, "Position should be created");

    // Verify NFT was transferred back to user
    assertEq(IERC721(address(wstETHLongPool)).balanceOf(user), initialNFTBalance + 1, "NFT should be transferred back to user");
    assertEq(IERC721(address(wstETHLongPool)).ownerOf(positionId), user, "User should own the NFT");

    // Verify fxUSD was received
    assertGt(IERC20(address(fxUSD)).balanceOf(user), initialFxUSDBalance, "User should receive fxUSD");

    // Verify wstETH was used
    assertLt(IERC20(wstETH).balanceOf(user), initialWstETHBalance, "User wstETH balance should decrease");
  }

  function testBorrowFromLongWithExistingPosition() public {
    // First create a position
    uint256 existingPositionId = _createTestPosition();
    
    uint256 borrowAmount = 500 ether; // 500 fxUSD
    uint256 wstETHAmount = 0.25 ether; // 0.25 wstETH

    // Record initial balances
    uint256 initialWstETHBalance = IERC20(wstETH).balanceOf(user);
    uint256 initialFxUSDBalance = IERC20(address(fxUSD)).balanceOf(user);
    uint256 initialNFTBalance = IERC721(address(wstETHLongPool)).balanceOf(user);

    // Create ConvertInParams for wstETH
    LibRouter.ConvertInParams memory convertInParams = LibRouter.ConvertInParams({
      tokenIn: wstETH,
      amount: wstETHAmount,
      target: ConverterAddress, // Direct transfer, no conversion needed
      data: "",
      minOut: 0,
      signature: ""
    });

    // Create BorrowFromLongParams with existing position
    PositionOperateFacet.BorrowFromLongParams memory borrowParams = PositionOperateFacet.BorrowFromLongParams({
      pool: address(wstETHLongPool),
      positionId: existingPositionId, // Existing position
      borrowAmount: borrowAmount
    });

    vm.startPrank(user);
    IERC721(address(wstETHLongPool)).approve(address(DiamondRouter), existingPositionId);
    IERC20(wstETH).approve(address(DiamondRouter), wstETHAmount);
    uint256 positionId = PositionOperateFacet(DiamondRouter).borrowFromLong(convertInParams, borrowParams);
    vm.stopPrank();

    // Verify same position ID was returned
    assertEq(positionId, existingPositionId, "Should return the same position ID");

    // Verify NFT was transferred back to user
    assertEq(IERC721(address(wstETHLongPool)).balanceOf(user), initialNFTBalance, "NFT count should remain the same");
    assertEq(IERC721(address(wstETHLongPool)).ownerOf(positionId), user, "User should still own the NFT");

    // Verify fxUSD was received
    assertGt(IERC20(address(fxUSD)).balanceOf(user), initialFxUSDBalance, "User should receive additional fxUSD");

    // Verify wstETH was used
    assertLt(IERC20(wstETH).balanceOf(user), initialWstETHBalance, "User wstETH balance should decrease");
  }

  function testRepayToLongWithFxUSD() public {
    // First create a position and borrow
    uint256 positionId = _createTestPosition();
    
    uint256 withdrawAmount = 0.25 ether; // 0.25 wstETH

    // Record initial balances
    uint256 initialFxUSDBalance = IERC20(address(fxUSD)).balanceOf(user);
    uint256 initialWstETHBalance = IERC20(wstETH).balanceOf(user);
    uint256 initialNFTBalance = IERC721(address(wstETHLongPool)).balanceOf(user);

    // Create ConvertInParams for fxUSD
    LibRouter.ConvertInParams memory convertInParams = LibRouter.ConvertInParams({
      tokenIn: address(fxUSD),
      amount: 1000 ether, // Small amount for conversion
      target: ConverterAddress, // Direct transfer for this test
      data: "",
      minOut: 0,
      signature: ""
    });

    // Create RepayToLongParams
    PositionOperateFacet.RepayToLongParams memory repayParams = PositionOperateFacet.RepayToLongParams({
      pool: address(wstETHLongPool),
      positionId: positionId,
      withdrawAmount: withdrawAmount
    });

    vm.startPrank(user);
    IERC721(address(wstETHLongPool)).approve(address(DiamondRouter), positionId);
    IERC20(address(fxUSD)).approve(address(DiamondRouter), 1000 ether);
    PositionOperateFacet(DiamondRouter).repayToLong(convertInParams, repayParams);
    vm.stopPrank();

    // Verify NFT was transferred back to user
    assertEq(IERC721(address(wstETHLongPool)).balanceOf(user), initialNFTBalance, "NFT count should remain the same");
    assertEq(IERC721(address(wstETHLongPool)).ownerOf(positionId), user, "User should still own the NFT");

    // Verify wstETH was received (withdrawn collateral)
    assertGt(IERC20(wstETH).balanceOf(user), initialWstETHBalance, "User should receive wstETH collateral");

    // Verify fxUSD was used for conversion
    assertLt(IERC20(address(fxUSD)).balanceOf(user), initialFxUSDBalance, "User fxUSD balance should decrease");
  }

  function testRepayToLongFullPositionClosure() public {
    // First create a position and borrow
    uint256 positionId = _createTestPosition();
    
    // Get the position details to understand the debt
    (uint256 collateral, uint256 rawDebts) = ILongPool(address(wstETHLongPool)).getPosition(positionId);
    
    // Use fxUSD amount larger than position debt to trigger full closure
    uint256 repayAmount = rawDebts + 1000 ether; // 1000 ether more than debt
    uint256 withdrawAmount = collateral; // Withdraw all collateral

    // Record initial balances
    uint256 initialFxUSDBalance = IERC20(address(fxUSD)).balanceOf(user);
    uint256 initialWstETHBalance = IERC20(wstETH).balanceOf(user);
    uint256 initialNFTBalance = IERC721(address(wstETHLongPool)).balanceOf(user);

    // Create ConvertInParams for fxUSD
    LibRouter.ConvertInParams memory convertInParams = LibRouter.ConvertInParams({
      tokenIn: address(fxUSD),
      amount: repayAmount,
      target: ConverterAddress, // Direct transfer for this test
      data: "",
      minOut: 0,
      signature: ""
    });

    // Create RepayToLongParams
    PositionOperateFacet.RepayToLongParams memory repayParams = PositionOperateFacet.RepayToLongParams({
      pool: address(wstETHLongPool),
      positionId: positionId,
      withdrawAmount: withdrawAmount
    });

    vm.startPrank(user);
    IERC721(address(wstETHLongPool)).approve(address(DiamondRouter), positionId);
    IERC20(address(fxUSD)).approve(address(DiamondRouter), repayAmount);
    PositionOperateFacet(DiamondRouter).repayToLong(convertInParams, repayParams);
    vm.stopPrank();

    // Verify NFT was transferred back to user
    assertEq(IERC721(address(wstETHLongPool)).balanceOf(user), initialNFTBalance, "NFT count should remain the same");
    assertEq(IERC721(address(wstETHLongPool)).ownerOf(positionId), user, "User should still own the NFT");

    // Verify wstETH was received (withdrawn collateral) - should be all collateral
    assertGt(IERC20(wstETH).balanceOf(user), initialWstETHBalance, "User should receive wstETH collateral");
    
    // Verify the position is fully closed by checking the position state
    (uint256 finalCollateral, uint256 finalDebts) = ILongPool(address(wstETHLongPool)).getPosition(positionId);
    assertEq(finalDebts, 0, "Position debt should be zero after full closure");
    assertEq(finalCollateral, 0, "Position collateral should be zero after full closure");

    // Verify fxUSD was used for repayment
    assertLt(IERC20(address(fxUSD)).balanceOf(user), initialFxUSDBalance, "User fxUSD balance should decrease");
  }
}
