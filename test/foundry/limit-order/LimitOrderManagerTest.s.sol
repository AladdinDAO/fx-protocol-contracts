// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

import { PoolTestBase } from "test/foundry/PoolTestBase.s.sol";

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { LimitOrderManager } from "contracts/limit-order/LimitOrderManager.sol";
import { OrderLibrary } from "contracts/limit-order/OrderLibrary.sol";
import { OrderExecutionLibrary } from "contracts/limit-order/OrderExecutionLibrary.sol";
import { ILimitOrderManager } from "contracts/limit-order/ILimitOrderManager.sol";
import { MockERC20 } from "contracts/mocks/MockERC20.sol";

import { IPool } from "contracts/interfaces/IPool.sol";

contract LimitOrderManagerTest is Test, PoolTestBase {
  using OrderExecutionLibrary for OrderExecutionLibrary.Execution;

  LimitOrderManager internal limitOrderManager;

  // test actors
  address internal maker;
  uint256 internal makerPk;
  address internal taker;

  uint256 internal makerLongPositionId;
  uint256 internal makerShortPositionId;

  function setUp() public {
    __PoolTestBase_setUp(1 ether, 18);
    treasury = makeAddr("treasury");

    limitOrderManager = new LimitOrderManager(address(poolManager), address(shortPoolManager), address(fxUSD));
    limitOrderManager.initialize(address(this), address(treasury));

    makerPk = 0xA11CE;
    maker = vm.addr(makerPk);
    taker = makeAddr("taker");

    whitelist.approveWallet(address(limitOrderManager));
    whitelist.approveWallet(address(taker));
    whitelist.approveWallet(address(maker));

    // update parameters
    longPool.updateDebtRatioRange(0, 1e18);
    longPool.updateRebalanceRatios(0.88 ether, 5e7);
    longPool.updateLiquidateRatios(0.92 ether, 5e7);
    poolManager.updateShortBorrowCapacityRatio(address(longPool), 1e18);
    shortPool.updateDebtRatioRange(0, 1e18);
    shortPool.updateRebalanceRatios(0.88 ether, 5e7);
    shortPool.updateLiquidateRatios(0.92 ether, 5e7);
  }

  function _prepareBalances() internal {
    // maker open a long position
    vm.startPrank(maker);
    collateralToken.mint(maker, 100 ether);
    collateralToken.approve(address(poolManager), 100 ether);
    makerLongPositionId = poolManager.operate(address(longPool), 0, 100 ether, 100000 ether);
    vm.stopPrank();

    // maker open a short position
    vm.startPrank(maker);
    fxUSD.approve(address(shortPoolManager), 30000 ether);
    makerShortPositionId = shortPoolManager.operate(address(shortPool), 0, 30000 ether, 2 ether);
    vm.stopPrank();

    // maker has 70000 fxUSD and 2 ether collateral
    assertEq(fxUSD.balanceOf(maker), 70000 ether);
    assertEq(collateralToken.balanceOf(maker), 2 ether);

    // taker open a long position
    vm.startPrank(taker);
    collateralToken.mint(taker, 200 ether);
    collateralToken.approve(address(poolManager), 100 ether);
    poolManager.operate(address(longPool), 0, 100 ether, 100000 ether);
    vm.stopPrank();

    // taker has 100000 fxUSD and 100 ether collateral
    assertEq(fxUSD.balanceOf(taker), 100000 ether);
    assertEq(collateralToken.balanceOf(taker), 100 ether);
  }

  function _baseOrder(bool positionSide, bool orderSide) internal view returns (OrderLibrary.Order memory order) {
    // Open long, minimal values to avoid external calls and transfers
    order.maker = maker;
    order.pool = address(longPool);
    order.positionId = 0;
    order.positionSide = positionSide; // long
    order.orderSide = orderSide; // open
    order.allowPartialFill = true;
    order.triggerPrice = 0; // skip oracle check
    order.fxUSDDelta = 0;
    order.collDelta = 1; // taking amount > 0
    order.debtDelta = 0;
    order.nonce = 0;
    order.salt = keccak256(abi.encodePacked("salt", block.number));
    order.deadline = block.timestamp + 1 days;
  }

  function _hashAndSign(OrderLibrary.Order memory order) internal view returns (bytes memory sig) {
    bytes32 digest = limitOrderManager.getOrderHash(order);
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerPk, digest);
    sig = abi.encodePacked(r, s, v);
  }

  function _prepareTakerBalances(OrderLibrary.Order memory order, uint256 makingAmount, uint256 takingAmount) internal {
    (address makingToken, address takingToken, , ) = limitOrderManager.getOrderDetails(order);
    // Due to implementation using reversed amounts in transferFrom, fund as required:
    // - taker must send takingToken of amount = makingAmount
    // - taker must send makingToken of amount = takingAmount
    if (makingToken != address(0)) {
      MockERC20(makingToken).mint(taker, takingAmount);
      vm.prank(taker);
      MockERC20(makingToken).approve(address(limitOrderManager), type(uint256).max);
    }
    if (takingToken != address(0)) {
      MockERC20(takingToken).mint(taker, makingAmount);
      vm.prank(taker);
      MockERC20(takingToken).approve(address(limitOrderManager), type(uint256).max);
    }
  }

  function testIncreaseNonceEmitsEvent() public {
    vm.startPrank(maker);
    vm.expectEmit(true, true, true, true);
    emit ILimitOrderManager.AdvanceNonce(maker, 0);
    limitOrderManager.increaseNonce();
    vm.stopPrank();
  }

  function testFillOrder_RevertBadSignature() public {
    OrderLibrary.Order memory order = _baseOrder(true, true);
    bytes memory badSig = hex""; // invalid length
    vm.prank(taker);
    vm.expectRevert(LimitOrderManager.ErrBadSignature.selector);
    limitOrderManager.fillOrder(order, badSig, 1, 1);
  }

  function testFillOrder_RevertOrderNonceExpired() public {
    OrderLibrary.Order memory order = _baseOrder(true, true);
    order.nonce = 1; // current Nonces for maker is 0
    bytes memory sig = _hashAndSign(order);
    vm.prank(taker);
    vm.expectRevert(LimitOrderManager.ErrOrderNonceExpired.selector);
    limitOrderManager.fillOrder(order, sig, 1, 1);
  }

  function testFillOrder_RevertOrderCancelled() public {
    OrderLibrary.Order memory order = _baseOrder(true, true);
    bytes memory sig = _hashAndSign(order);
    // maker cancels first
    vm.prank(maker);
    limitOrderManager.cancelOrder(order);
    // taker attempts to fill after cancellation
    vm.prank(taker);
    vm.expectRevert(LimitOrderManager.ErrOrderCancelledOrFullyFilled.selector);
    limitOrderManager.fillOrder(order, sig, 1, 1);

    // Skipped OrderFullyFilled path as it requires setting internal storage or full fill flow
  }

  function testFillOrder_RevertCannotBeFullyFilled() public {
    OrderLibrary.Order memory order = _baseOrder(true, true);
    order.allowPartialFill = false;
    // order making amount = fxUSDDelta + debtDelta = 0; but taking amount = collDelta = 1
    // Use takingAmount < orderMakingAmount OR makingAmount < orderTakingAmount to trigger
    order.fxUSDDelta = 1; // now making amount = 1
    bytes memory sig = _hashAndSign(order);
    // Provide takingAmount=0 (<1) or makingAmount < orderTakingAmount (=1)
    vm.prank(taker);
    vm.expectRevert(LimitOrderManager.ErrOrderCannotBeFullyFilled.selector);
    limitOrderManager.fillOrder(order, sig, 1, 0);
  }

  function testFillOrder_RevertInsufficientMakingAmount() public {
    OrderLibrary.Order memory order = _baseOrder(true, true);
    // Make orderTakingAmount >> orderMakingAmount so minMakingAmount > 0
    order.collDelta = 10; // taking amount
    order.fxUSDDelta = 1; // making amount
    bytes memory sig = _hashAndSign(order);
    // For actualTaking=1, minMaking = 1 * 10 / 1 = 10; offer 9 to revert
    vm.prank(taker);
    vm.expectRevert(LimitOrderManager.ErrInsufficientMakingAmount.selector);
    limitOrderManager.fillOrder(order, sig, 9, 1);
  }

  function testFillOrder_OpenLong_NewPosition() public {
    _prepareBalances();

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(longPool);
    order.positionId = 0;
    order.positionSide = true; // long
    order.orderSide = true; // open
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = 3000 ether;
    order.collDelta = 2 ether;
    order.debtDelta = 3000 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(11));
    order.deadline = block.timestamp + 1 days;
    bytes32 orderHash = limitOrderManager.getOrderHash(order);
    (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) = limitOrderManager
      .getOrderDetails(order);
    assertEq(makingToken, address(fxUSD), "makingToken should be fxUSD for open long");
    assertEq(takingToken, address(collateralToken), "takingToken should be collateral for open long");
    assertEq(makingAmount, 6000 ether);
    assertEq(takingAmount, 2 ether);

    bytes memory sig = _hashAndSign(order);

    // maker approve 3000 fxUSD to limitOrderManager
    vm.prank(maker);
    fxUSD.approve(address(limitOrderManager), 3000 ether);

    // taker partially fill the order, provide 0.5 ether collateral, take 1500 ether fxUSD
    uint256 takerFxUSDBalance = fxUSD.balanceOf(taker);
    uint256 takerCollateralBalance = collateralToken.balanceOf(taker);
    uint256 makerFxUSDBalance = fxUSD.balanceOf(maker);
    uint256 makerCollateralBalance = collateralToken.balanceOf(maker);
    vm.startPrank(taker);
    collateralToken.approve(address(limitOrderManager), 0.5 ether);
    vm.expectEmit(true, true, true, true);
    emit ILimitOrderManager.FillOrder(orderHash, maker, taker, address(longPool), makerLongPositionId + 2, 1500 ether, 0.5 ether);
    limitOrderManager.fillOrder(order, sig, 0.5 ether, 1500 ether);
    vm.stopPrank();
    assertEq(fxUSD.balanceOf(taker), takerFxUSDBalance + 1500 ether);
    assertEq(collateralToken.balanceOf(taker), takerCollateralBalance - 0.5 ether);
    assertEq(fxUSD.balanceOf(maker), makerFxUSDBalance - 750 ether);
    assertEq(collateralToken.balanceOf(maker), makerCollateralBalance);

    OrderExecutionLibrary.Execution memory e = limitOrderManager.getExecution(orderHash);
    assertGt(e.positionId, 0, "positionId should be greater than 0");
    assertEq(uint256(e.status), uint256(OrderExecutionLibrary.Status.PartialFilled));
    assertEq(e.filled, uint128(1500 ether));
    assertEq(IERC721(address(longPool)).ownerOf(e.positionId), address(limitOrderManager));

    (uint256 rawColls, uint256 rawDebts) = IPool(address(longPool)).getPosition(e.positionId);
    assertEq(rawColls, 0.5 ether);
    assertEq(rawDebts, 750 ether);

    // taker fully fill the order, provide 2.6 ether collateral, take 4500 ether fxUSD, but actually cost 1.5 ether collateral and take 4500 ether fxUSD
    takerFxUSDBalance = fxUSD.balanceOf(taker);
    takerCollateralBalance = collateralToken.balanceOf(taker);
    makerFxUSDBalance = fxUSD.balanceOf(maker);
    makerCollateralBalance = collateralToken.balanceOf(maker);
    vm.startPrank(taker);
    collateralToken.approve(address(limitOrderManager), 1.5 ether);
    vm.expectEmit(true, true, true, true);
    emit ILimitOrderManager.FillOrder(orderHash, maker, taker, address(longPool), makerLongPositionId + 2, 4500 ether, 1.5 ether);
    limitOrderManager.fillOrder(order, sig, 2.6 ether, 4500 ether);
    vm.stopPrank();
    assertEq(fxUSD.balanceOf(taker), takerFxUSDBalance + 4500 ether);
    assertEq(collateralToken.balanceOf(taker), takerCollateralBalance - 1.5 ether);
    assertEq(fxUSD.balanceOf(maker), makerFxUSDBalance - 2250 ether);
    assertEq(collateralToken.balanceOf(maker), makerCollateralBalance);

    e = limitOrderManager.getExecution(orderHash);
    assertGt(e.positionId, 0, "positionId should be greater than 0");
    assertEq(uint256(e.status), uint256(OrderExecutionLibrary.Status.FullyFilled));
    assertEq(e.filled, uint128(6000 ether));
    assertEq(IERC721(address(longPool)).ownerOf(e.positionId), address(maker));

    (rawColls, rawDebts) = IPool(address(longPool)).getPosition(e.positionId);
    assertEq(rawColls, 2 ether);
    assertEq(rawDebts, 3000 ether);

    // cancel the order, should revert
    vm.prank(maker);
    vm.expectRevert(LimitOrderManager.ErrOrderAlreadyFilled.selector);
    limitOrderManager.cancelOrder(order);
  }

  function testFillOrder_OpenLong_OldPosition() public {
    _prepareBalances();

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(longPool);
    order.positionId = makerLongPositionId;
    order.positionSide = true; // long
    order.orderSide = true; // open
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = 3000 ether;
    order.collDelta = 2 ether;
    order.debtDelta = 3000 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(11));
    order.deadline = block.timestamp + 1 days;
    bytes32 orderHash = limitOrderManager.getOrderHash(order);

    (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) = limitOrderManager
      .getOrderDetails(order);
    assertEq(makingToken, address(fxUSD), "makingToken should be fxUSD for open long");
    assertEq(takingToken, address(collateralToken), "takingToken should be collateral for open long");
    assertEq(makingAmount, 6000 ether);
    assertEq(takingAmount, 2 ether);

    bytes memory sig = _hashAndSign(order);

    // maker approve 3000 fxUSD to limitOrderManager
    vm.startPrank(maker);
    fxUSD.approve(address(limitOrderManager), 3000 ether);
    IERC721(address(longPool)).setApprovalForAll(address(limitOrderManager), true);
    vm.stopPrank();

    // taker partially fill the order, provide 0.5 ether collateral, take 1500 ether fxUSD
    uint256 takerFxUSDBalance = fxUSD.balanceOf(taker);
    uint256 takerCollateralBalance = collateralToken.balanceOf(taker);
    uint256 makerFxUSDBalance = fxUSD.balanceOf(maker);
    uint256 makerCollateralBalance = collateralToken.balanceOf(maker);
    vm.startPrank(taker);
    collateralToken.approve(address(limitOrderManager), 0.5 ether);
    vm.expectEmit(true, true, true, true);
    emit ILimitOrderManager.FillOrder(orderHash, maker, taker, address(longPool), makerLongPositionId, 1500 ether, 0.5 ether);
    limitOrderManager.fillOrder(order, sig, 0.5 ether, 1500 ether);
    vm.stopPrank();
    assertEq(fxUSD.balanceOf(taker), takerFxUSDBalance + 1500 ether);
    assertEq(collateralToken.balanceOf(taker), takerCollateralBalance - 0.5 ether);
    assertEq(fxUSD.balanceOf(maker), makerFxUSDBalance - 750 ether);
    assertEq(collateralToken.balanceOf(maker), makerCollateralBalance);

    OrderExecutionLibrary.Execution memory e = limitOrderManager.getExecution(orderHash);
    assertEq(e.positionId, makerLongPositionId);
    assertEq(uint256(e.status), uint256(OrderExecutionLibrary.Status.PartialFilled));
    assertEq(e.filled, uint128(1500 ether));
    assertEq(IERC721(address(longPool)).ownerOf(e.positionId), address(maker));

    (uint256 rawColls, uint256 rawDebts) = IPool(address(longPool)).getPosition(e.positionId);
    assertEq(rawColls, 100 ether + 0.5 ether);
    assertEq(rawDebts, 100000 ether + 750 ether);

    // taker fully fill the order, provide 2.6 ether collateral, take 4500 ether fxUSD, but actually cost 1.5 ether collateral and take 4500 ether fxUSD
    takerFxUSDBalance = fxUSD.balanceOf(taker);
    takerCollateralBalance = collateralToken.balanceOf(taker);
    makerFxUSDBalance = fxUSD.balanceOf(maker);
    makerCollateralBalance = collateralToken.balanceOf(maker);
    vm.startPrank(taker);
    collateralToken.approve(address(limitOrderManager), 1.5 ether);
    vm.expectEmit(true, true, true, true);
    emit ILimitOrderManager.FillOrder(orderHash, maker, taker, address(longPool), makerLongPositionId, 4500 ether, 1.5 ether);
    limitOrderManager.fillOrder(order, sig, 2.6 ether, 4500 ether);
    vm.stopPrank();
    assertEq(fxUSD.balanceOf(taker), takerFxUSDBalance + 4500 ether);
    assertEq(collateralToken.balanceOf(taker), takerCollateralBalance - 1.5 ether);
    assertEq(fxUSD.balanceOf(maker), makerFxUSDBalance - 2250 ether);
    assertEq(collateralToken.balanceOf(maker), makerCollateralBalance);

    e = limitOrderManager.getExecution(orderHash);
    assertEq(e.positionId, makerLongPositionId);
    assertEq(uint256(e.status), uint256(OrderExecutionLibrary.Status.FullyFilled));
    assertEq(e.filled, uint128(6000 ether));
    assertEq(IERC721(address(longPool)).ownerOf(e.positionId), address(maker));

    (rawColls, rawDebts) = IPool(address(longPool)).getPosition(e.positionId);
    assertEq(rawColls, 100 ether + 2 ether);
    assertEq(rawDebts, 100000 ether + 3000 ether);
  }

  function testFillOrder_CloseLong() public {
    _prepareBalances();

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(longPool);
    order.positionId = makerLongPositionId;
    order.positionSide = true; // long
    order.orderSide = false; // close
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = -3000 ether;
    order.collDelta = -2 ether;
    order.debtDelta = -3000 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(12));
    order.deadline = block.timestamp + 1 days;
    bytes32 orderHash = limitOrderManager.getOrderHash(order);
    (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) = limitOrderManager
      .getOrderDetails(order);
    assertEq(makingToken, address(collateralToken), "makingToken should be collateral for close long");
    assertEq(takingToken, address(fxUSD), "takingToken should be fxUSD for close long");
    assertEq(makingAmount, 2 ether);
    assertEq(takingAmount, 6000 ether);

    bytes memory sig = _hashAndSign(order);

    // maker approve NFT to limitOrderManager
    vm.startPrank(maker);
    IERC721(address(longPool)).setApprovalForAll(address(limitOrderManager), true);
    vm.stopPrank();

    (uint256 xrawColls, uint256 xrawDebts) = IPool(address(longPool)).getPosition(makerLongPositionId);

    // taker partially fill the order, provide 1500 ether fxUSD, take 0.5 ether collateral
    uint256 takerFxUSDBalance = fxUSD.balanceOf(taker);
    uint256 takerCollateralBalance = collateralToken.balanceOf(taker);
    uint256 makerFxUSDBalance = fxUSD.balanceOf(maker);
    uint256 makerCollateralBalance = collateralToken.balanceOf(maker);
    vm.startPrank(taker);
    fxUSD.approve(address(limitOrderManager), 1500 ether);
    vm.expectEmit(true, true, true, true);
    emit ILimitOrderManager.FillOrder(orderHash, maker, taker, address(longPool), makerLongPositionId, 0.5 ether, 1500 ether);
    limitOrderManager.fillOrder(order, sig, 1500 ether, 0.5 ether);
    vm.stopPrank();
    assertEq(fxUSD.balanceOf(taker), takerFxUSDBalance - 1500 ether);
    assertEq(collateralToken.balanceOf(taker), takerCollateralBalance + 0.5 ether);
    assertEq(fxUSD.balanceOf(maker), makerFxUSDBalance + 750 ether);
    assertEq(collateralToken.balanceOf(maker), makerCollateralBalance);

    OrderExecutionLibrary.Execution memory e = limitOrderManager.getExecution(orderHash);
    assertEq(e.positionId, makerLongPositionId);
    assertEq(uint256(e.status), uint256(OrderExecutionLibrary.Status.PartialFilled));
    assertEq(e.filled, uint128(0.5 ether));

    (uint256 rawColls, uint256 rawDebts) = IPool(address(longPool)).getPosition(e.positionId);
    assertEq(rawColls, 100 ether - 0.5 ether);
    assertEq(rawDebts, 100000 ether - 750 ether);
  }

  function testFillOrder_OpenShort_NewPosition() public {
    _prepareBalances();

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(shortPool);
    order.positionId = 0;
    order.positionSide = false; // short
    order.orderSide = true; // open
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = 3000 ether;
    order.collDelta = 6000 ether;
    order.debtDelta = 1 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(11));
    order.deadline = block.timestamp + 1 days;
    bytes32 orderHash = limitOrderManager.getOrderHash(order);
    (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) = limitOrderManager
      .getOrderDetails(order);
    assertEq(makingToken, address(collateralToken), "makingToken should be collateral for open short");
    assertEq(takingToken, address(fxUSD), "takingToken should be fxUSD for open short");
    assertEq(makingAmount, 1 ether);
    assertEq(takingAmount, 3000 ether);

    bytes memory sig = _hashAndSign(order);

    // maker approve 3000 fxUSD to limitOrderManager
    vm.prank(maker);
    fxUSD.approve(address(limitOrderManager), 3000 ether);

    // taker partially fill the order, provide 1500 ether fxUSD, take 0.5 ether collateral
    uint256 takerFxUSDBalance = fxUSD.balanceOf(taker);
    uint256 takerCollateralBalance = collateralToken.balanceOf(taker);
    uint256 makerFxUSDBalance = fxUSD.balanceOf(maker);
    uint256 makerCollateralBalance = collateralToken.balanceOf(maker);
    vm.startPrank(taker);
    fxUSD.approve(address(limitOrderManager), 1500 ether);
    vm.expectEmit(true, true, true, true);
    emit ILimitOrderManager.FillOrder(orderHash, maker, taker, address(shortPool), makerShortPositionId + 1, 0.5 ether, 1500 ether);
    limitOrderManager.fillOrder(order, sig, 1500 ether, 0.5 ether);
    vm.stopPrank();
    assertEq(fxUSD.balanceOf(taker), takerFxUSDBalance - 1500 ether);
    assertEq(collateralToken.balanceOf(taker), takerCollateralBalance + 0.5 ether);
    assertEq(fxUSD.balanceOf(maker), makerFxUSDBalance - 1500 ether);
    assertEq(collateralToken.balanceOf(maker), makerCollateralBalance);

    OrderExecutionLibrary.Execution memory e = limitOrderManager.getExecution(orderHash);
    assertGt(e.positionId, 0, "positionId should be greater than 0");
    assertEq(uint256(e.status), uint256(OrderExecutionLibrary.Status.PartialFilled));
    assertEq(e.filled, uint128(0.5 ether));
    assertEq(IERC721(address(shortPool)).ownerOf(e.positionId), address(limitOrderManager));

    (uint256 rawColls, uint256 rawDebts) = IPool(address(shortPool)).getPosition(e.positionId);
    assertEq(rawColls, 3000 ether);
    assertEq(rawDebts, 0.5 ether);

    // taker fully fill the order, provide 5000 ether fxUSD, take 10 ether collateral, but actually provide 1500 ether fxUSD, take 0.5 ether collateral
    takerFxUSDBalance = fxUSD.balanceOf(taker);
    takerCollateralBalance = collateralToken.balanceOf(taker);
    makerFxUSDBalance = fxUSD.balanceOf(maker);
    makerCollateralBalance = collateralToken.balanceOf(maker);
    vm.startPrank(taker);
    fxUSD.approve(address(limitOrderManager), 1500 ether);
    vm.expectEmit(true, true, true, true);
    emit ILimitOrderManager.FillOrder(orderHash, maker, taker, address(shortPool), makerShortPositionId + 1, 0.5 ether, 1500 ether);
    limitOrderManager.fillOrder(order, sig, 50000 ether, 0.5 ether);
    vm.stopPrank();
    assertEq(fxUSD.balanceOf(taker), takerFxUSDBalance - 1500 ether);
    assertEq(collateralToken.balanceOf(taker), takerCollateralBalance + 0.5 ether);
    assertEq(fxUSD.balanceOf(maker), makerFxUSDBalance - 1500 ether);
    assertEq(collateralToken.balanceOf(maker), makerCollateralBalance);

    e = limitOrderManager.getExecution(orderHash);
    assertGt(e.positionId, 0, "positionId should be greater than 0");
    assertEq(uint256(e.status), uint256(OrderExecutionLibrary.Status.FullyFilled));
    assertEq(e.filled, uint128(1 ether));
    assertEq(IERC721(address(shortPool)).ownerOf(e.positionId), address(maker));

    (rawColls, rawDebts) = IPool(address(shortPool)).getPosition(e.positionId);
    assertEq(rawColls, 6000 ether);
    assertEq(rawDebts, 1 ether);
  }

  function testFillOrder_OpenShort_OldPosition() public {
    _prepareBalances();

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(shortPool);
    order.positionId = makerShortPositionId;
    order.positionSide = false; // short
    order.orderSide = true; // open
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = 3000 ether;
    order.collDelta = 6000 ether;
    order.debtDelta = 1 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(11));
    order.deadline = block.timestamp + 1 days;
    bytes32 orderHash = limitOrderManager.getOrderHash(order);
    (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) = limitOrderManager
      .getOrderDetails(order);
    assertEq(makingToken, address(collateralToken), "makingToken should be collateral for open short");
    assertEq(takingToken, address(fxUSD), "takingToken should be fxUSD for open short");
    assertEq(makingAmount, 1 ether);
    assertEq(takingAmount, 3000 ether);

    bytes memory sig = _hashAndSign(order);

    // maker approve 3000 fxUSD to limitOrderManager
    vm.startPrank(maker);
    fxUSD.approve(address(limitOrderManager), 3000 ether);
    IERC721(address(shortPool)).setApprovalForAll(address(limitOrderManager), true);
    vm.stopPrank();

    (uint256 rawColls, uint256 rawDebts) = IPool(address(shortPool)).getPosition(makerShortPositionId);
    assertEq(rawColls, 30000 ether);
    assertEq(rawDebts, 2 ether);

    // taker partially fill the order, provide 1500 ether fxUSD, take 0.5 ether collateral
    uint256 takerFxUSDBalance = fxUSD.balanceOf(taker);
    uint256 takerCollateralBalance = collateralToken.balanceOf(taker);
    uint256 makerFxUSDBalance = fxUSD.balanceOf(maker);
    uint256 makerCollateralBalance = collateralToken.balanceOf(maker);
    vm.startPrank(taker);
    fxUSD.approve(address(limitOrderManager), 1500 ether);
    vm.expectEmit(true, true, true, true);
    emit ILimitOrderManager.FillOrder(orderHash, maker, taker, address(shortPool), makerShortPositionId, 0.5 ether, 1500 ether);
    limitOrderManager.fillOrder(order, sig, 1500 ether, 0.5 ether);
    vm.stopPrank();
    assertEq(fxUSD.balanceOf(taker), takerFxUSDBalance - 1500 ether);
    assertEq(collateralToken.balanceOf(taker), takerCollateralBalance + 0.5 ether);
    assertEq(fxUSD.balanceOf(maker), makerFxUSDBalance - 1500 ether);
    assertEq(collateralToken.balanceOf(maker), makerCollateralBalance);

    OrderExecutionLibrary.Execution memory e = limitOrderManager.getExecution(orderHash);
    assertGt(e.positionId, 0, "positionId should be greater than 0");
    assertEq(uint256(e.status), uint256(OrderExecutionLibrary.Status.PartialFilled));
    assertEq(e.filled, uint128(0.5 ether));
    assertEq(IERC721(address(shortPool)).ownerOf(e.positionId), address(maker));
    IPool(address(shortPool)).getPosition(e.positionId);

    (rawColls, rawDebts) = IPool(address(shortPool)).getPosition(makerShortPositionId);
    assertEq(rawColls, 30000 ether + 3000 ether);
    assertEq(rawDebts, 2 ether + 0.5 ether);
  }

  function testFillOrder_CloseShort() public {
    _prepareBalances();

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(shortPool);
    order.positionId = makerShortPositionId;
    order.positionSide = false; // short
    order.orderSide = false; // close
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = -3000 ether;
    order.collDelta = -6000 ether;
    order.debtDelta = -1 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(12));
    order.deadline = block.timestamp + 1 days;
    bytes32 orderHash = limitOrderManager.getOrderHash(order);
    (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) = limitOrderManager
      .getOrderDetails(order);
    assertEq(makingToken, address(fxUSD), "makingToken should be collateral for close short");
    assertEq(takingToken, address(collateralToken), "takingToken should be fxUSD for close short");
    assertEq(makingAmount, 3000 ether);
    assertEq(takingAmount, 1 ether);

    bytes memory sig = _hashAndSign(order);

    // maker approve position NFT to limitOrderManager
    vm.startPrank(maker);
    IERC721(address(shortPool)).setApprovalForAll(address(limitOrderManager), true);
    vm.stopPrank();

    // taker partially fill the order, provide 0.5 ether collateral, take 1500 ether fxUSD
    uint256 takerFxUSDBalance = fxUSD.balanceOf(taker);
    uint256 takerCollateralBalance = collateralToken.balanceOf(taker);
    uint256 makerFxUSDBalance = fxUSD.balanceOf(maker);
    uint256 makerCollateralBalance = collateralToken.balanceOf(maker);
    vm.startPrank(taker);
    collateralToken.approve(address(limitOrderManager), 0.5 ether);
    vm.expectEmit(true, true, true, true);
    emit ILimitOrderManager.FillOrder(orderHash, maker, taker, address(shortPool), makerShortPositionId, 1500 ether, 0.5 ether);
    limitOrderManager.fillOrder(order, sig, 0.5 ether, 1500 ether);
    vm.stopPrank();
    assertEq(fxUSD.balanceOf(taker), takerFxUSDBalance + 1500 ether);
    assertEq(collateralToken.balanceOf(taker), takerCollateralBalance - 0.5 ether);
    assertEq(fxUSD.balanceOf(maker), makerFxUSDBalance + 1500 ether);
    assertEq(collateralToken.balanceOf(maker), makerCollateralBalance);

    OrderExecutionLibrary.Execution memory e = limitOrderManager.getExecution(orderHash);
    assertEq(e.positionId, makerShortPositionId);
    assertEq(uint256(e.status), uint256(OrderExecutionLibrary.Status.PartialFilled));
    assertEq(e.filled, uint128(1500 ether));

    (uint256 rawColls, uint256 rawDebts) = IPool(address(shortPool)).getPosition(e.positionId);
    assertEq(rawColls, 30000 ether - 3000 ether);
    assertEq(rawDebts, 2 ether - 0.5 ether);
  }

  function testFillOrder_OpenLong_NewPositionWithFee() public {
    _prepareBalances();

    // update pool fee ratio
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 1e7, 1e18, 2e7, 3e7, 4e7);
    poolConfiguration.updatePoolFeeRatio(address(shortPool), address(0), 1e7, 1e18, 2e7, 3e7, 4e7);

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(longPool);
    order.positionId = 0;
    order.positionSide = true; // long
    order.orderSide = true; // open
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = 3000 ether;
    order.collDelta = 2 ether;
    order.debtDelta = 3000 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(11));
    order.deadline = block.timestamp + 1 days;
    bytes memory sig = _hashAndSign(order);

    // maker approve 3000 fxUSD to limitOrderManager
    vm.prank(maker);
    fxUSD.approve(address(limitOrderManager), 3000 ether);

    vm.startPrank(taker);
    collateralToken.approve(address(limitOrderManager), 0.5 ether);
    limitOrderManager.fillOrder(order, sig, 0.5 ether, 1500 ether);

    collateralToken.approve(address(limitOrderManager), 1.5 ether);
    limitOrderManager.fillOrder(order, sig, 2.6 ether, 4500 ether);
    vm.stopPrank();
  }

  function testFillOrder_OpenLong_OldPositionWithFee() public {
    _prepareBalances();

    // update pool fee ratio
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 1e7, 1e18, 2e7, 3e7, 4e7);
    poolConfiguration.updatePoolFeeRatio(address(shortPool), address(0), 1e7, 1e18, 2e7, 3e7, 4e7);

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(longPool);
    order.positionId = makerLongPositionId;
    order.positionSide = true; // long
    order.orderSide = true; // open
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = 3000 ether;
    order.collDelta = 2 ether;
    order.debtDelta = 3000 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(11));
    order.deadline = block.timestamp + 1 days;
    bytes memory sig = _hashAndSign(order);

    // maker approve 3000 fxUSD to limitOrderManager
    vm.startPrank(maker);
    fxUSD.approve(address(limitOrderManager), 3000 ether);
    IERC721(address(longPool)).setApprovalForAll(address(limitOrderManager), true);
    vm.stopPrank();

    vm.startPrank(taker);
    collateralToken.approve(address(limitOrderManager), 0.5 ether);
    limitOrderManager.fillOrder(order, sig, 0.5 ether, 1500 ether);

    collateralToken.approve(address(limitOrderManager), 1.5 ether);
    limitOrderManager.fillOrder(order, sig, 2.6 ether, 4500 ether);
    vm.stopPrank();
  }

  function testFillOrder_CloseLongWithFee() public {
    _prepareBalances();
    // update pool fee ratio
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(limitOrderManager), 1e7, 1e18, 2e7, 3e7, 0);
    poolConfiguration.updatePoolFeeRatio(address(shortPool), address(limitOrderManager), 1e7, 1e18, 2e7, 3e7, 0);

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(longPool);
    order.positionId = makerLongPositionId;
    order.positionSide = true; // long
    order.orderSide = false; // close
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = -3000 ether;
    order.collDelta = -2 ether;
    order.debtDelta = -3000 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(12));
    order.deadline = block.timestamp + 1 days;
    bytes memory sig = _hashAndSign(order);

    // maker approve NFT to limitOrderManager
    vm.startPrank(maker);
    IERC721(address(longPool)).setApprovalForAll(address(limitOrderManager), true);
    vm.stopPrank();

    vm.startPrank(taker);
    fxUSD.approve(address(limitOrderManager), 1500 ether);
    limitOrderManager.fillOrder(order, sig, 1500 ether, 0.5 ether);
    vm.stopPrank();
  }

  function testFillOrder_OpenShort_NewPositionWithFee() public {
    _prepareBalances();
    // update pool fee ratio
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 1e7, 1e18, 2e7, 3e7, 4e7);
    poolConfiguration.updatePoolFeeRatio(address(shortPool), address(0), 1e7, 1e18, 2e7, 3e7, 4e7);

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(shortPool);
    order.positionId = 0;
    order.positionSide = false; // short
    order.orderSide = true; // open
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = 3000 ether;
    order.collDelta = 6000 ether;
    order.debtDelta = 1 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(11));
    order.deadline = block.timestamp + 1 days;
    bytes memory sig = _hashAndSign(order);

    // maker approve 3000 fxUSD to limitOrderManager
    vm.prank(maker);
    fxUSD.approve(address(limitOrderManager), 3000 ether);

    vm.startPrank(taker);
    fxUSD.approve(address(limitOrderManager), 1500 ether);
    limitOrderManager.fillOrder(order, sig, 1500 ether, 0.5 ether);

    fxUSD.approve(address(limitOrderManager), 1500 ether);
    limitOrderManager.fillOrder(order, sig, 50000 ether, 0.5 ether);
    vm.stopPrank();
  }

  function testFillOrder_OpenShort_OldPositionWithFee() public {
    _prepareBalances();
    // update pool fee ratio
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 1e7, 1e18, 2e7, 3e7, 4e7);
    poolConfiguration.updatePoolFeeRatio(address(shortPool), address(0), 1e7, 1e18, 2e7, 3e7, 4e7);

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(shortPool);
    order.positionId = makerShortPositionId;
    order.positionSide = false; // short
    order.orderSide = true; // open
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = 3000 ether;
    order.collDelta = 6000 ether;
    order.debtDelta = 1 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(11));
    order.deadline = block.timestamp + 1 days;
    bytes memory sig = _hashAndSign(order);

    // maker approve 3000 fxUSD to limitOrderManager
    vm.startPrank(maker);
    fxUSD.approve(address(limitOrderManager), 3000 ether);
    IERC721(address(shortPool)).setApprovalForAll(address(limitOrderManager), true);
    vm.stopPrank();

    vm.startPrank(taker);
    fxUSD.approve(address(limitOrderManager), 1500 ether);
    limitOrderManager.fillOrder(order, sig, 1500 ether, 0.5 ether);
    vm.stopPrank();
  }

  function testFillOrder_CloseShortWithFee() public {
    _prepareBalances();
    // update pool fee ratio
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(limitOrderManager), 1e7, 1e18, 2e7, 3e7, 0);
    poolConfiguration.updatePoolFeeRatio(address(shortPool), address(limitOrderManager), 1e7, 1e18, 2e7, 3e7, 0);

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(shortPool);
    order.positionId = makerShortPositionId;
    order.positionSide = false; // short
    order.orderSide = false; // close
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = -3000 ether;
    order.collDelta = -6000 ether;
    order.debtDelta = -1 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(12));
    order.deadline = block.timestamp + 1 days;
    bytes memory sig = _hashAndSign(order);

    // maker approve position NFT to limitOrderManager
    vm.startPrank(maker);
    IERC721(address(shortPool)).setApprovalForAll(address(limitOrderManager), true);
    vm.stopPrank();

    vm.startPrank(taker);
    collateralToken.approve(address(limitOrderManager), 0.5 ether);
    limitOrderManager.fillOrder(order, sig, 0.5 ether, 1500 ether);
    vm.stopPrank();
  }

  function testCancelOrder_RevertNotMaker() public {
    OrderLibrary.Order memory order = _baseOrder(true, true);
    vm.prank(taker);
    vm.expectRevert(LimitOrderManager.ErrNotMaker.selector);
    limitOrderManager.cancelOrder(order);
  }

  function testCancelOrder_RevertAlreadyCancelled() public {
    OrderLibrary.Order memory order = _baseOrder(true, true);
    vm.prank(maker);
    limitOrderManager.cancelOrder(order);
    vm.prank(maker);
    vm.expectRevert(LimitOrderManager.ErrOrderAlreadyCancelled.selector);
    limitOrderManager.cancelOrder(order);
  }

  function testCancelOrder_SendPositionToMaker() public {
    _prepareBalances();

    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(longPool);
    order.positionId = 0;
    order.positionSide = true; // long
    order.orderSide = true; // open
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = 3000 ether;
    order.collDelta = 2 ether;
    order.debtDelta = 3000 ether;
    order.nonce = 0;
    order.salt = bytes32(uint256(11));
    order.deadline = block.timestamp + 1 days;
    bytes32 orderHash = limitOrderManager.getOrderHash(order);

    (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) = limitOrderManager
      .getOrderDetails(order);
    assertEq(makingToken, address(fxUSD), "makingToken should be fxUSD for open long");
    assertEq(takingToken, address(collateralToken), "takingToken should be collateral for open long");
    assertEq(makingAmount, 6000 ether);
    assertEq(takingAmount, 2 ether);

    bytes memory sig = _hashAndSign(order);

    // maker approve 3000 fxUSD to limitOrderManager
    vm.prank(maker);
    fxUSD.approve(address(limitOrderManager), 3000 ether);

    // taker partially fill the order, provide 0.5 ether collateral, take 1500 ether fxUSD
    uint256 takerFxUSDBalance = fxUSD.balanceOf(taker);
    uint256 takerCollateralBalance = collateralToken.balanceOf(taker);
    uint256 makerFxUSDBalance = fxUSD.balanceOf(maker);
    uint256 makerCollateralBalance = collateralToken.balanceOf(maker);
    vm.startPrank(taker);
    collateralToken.approve(address(limitOrderManager), 0.5 ether);
    vm.expectEmit(true, true, true, true);
    emit ILimitOrderManager.FillOrder(orderHash, maker, taker, address(longPool), makerLongPositionId + 2, 1500 ether, 0.5 ether);
    limitOrderManager.fillOrder(order, sig, 0.5 ether, 1500 ether);
    vm.stopPrank();
    assertEq(fxUSD.balanceOf(taker), takerFxUSDBalance + 1500 ether);
    assertEq(collateralToken.balanceOf(taker), takerCollateralBalance - 0.5 ether);
    assertEq(fxUSD.balanceOf(maker), makerFxUSDBalance - 750 ether);
    assertEq(collateralToken.balanceOf(maker), makerCollateralBalance);

    OrderExecutionLibrary.Execution memory e = limitOrderManager.getExecution(orderHash);
    assertGt(e.positionId, 0, "positionId should be greater than 0");
    assertEq(uint256(e.status), uint256(OrderExecutionLibrary.Status.PartialFilled));
    assertEq(e.filled, uint128(1500 ether));
    assertEq(IERC721(address(longPool)).ownerOf(e.positionId), address(limitOrderManager));

    // cancel the order, should ok and transfer position to maker
    vm.prank(maker);
    limitOrderManager.cancelOrder(order);
    e = limitOrderManager.getExecution(orderHash);
    assertEq(uint256(e.status), uint256(OrderExecutionLibrary.Status.Cancelled));
    assertEq(e.filled, uint128(1500 ether));
    assertEq(IERC721(address(longPool)).ownerOf(e.positionId), address(maker));
  }

  function testGetOrderDetails_ReturnsAmounts() public {
    OrderLibrary.Order memory order = _baseOrder(true, true);
    (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) = limitOrderManager
      .getOrderDetails(order);
    // token addresses depend on constants; only assert amounts
    makingToken; // silence warnings
    takingToken;
    assertEq(makingAmount, OrderLibrary.getMakingAmount(order));
    assertEq(takingAmount, OrderLibrary.getTakingAmount(order));
  }

  function testGetOrderDetails_OpenLong() public {
    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(longPool);
    order.positionId = 0;
    order.positionSide = true; // long
    order.orderSide = true; // open
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = 5;
    order.collDelta = 3;
    order.debtDelta = 2;
    order.nonce = 0;
    order.salt = bytes32(uint256(1));
    order.deadline = block.timestamp + 1 days;

    (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) = limitOrderManager
      .getOrderDetails(order);
    assertEq(makingToken, address(fxUSD), "makingToken should be fxUSD for open long");
    assertEq(takingToken, address(collateralToken), "takingToken should be collateral for open long");
    assertEq(makingAmount, OrderLibrary.getMakingAmount(order));
    assertEq(takingAmount, OrderLibrary.getTakingAmount(order));
  }

  function testGetOrderDetails_CloseLong() public {
    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(longPool);
    order.positionId = 0;
    order.positionSide = true; // long
    order.orderSide = false; // close
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = -1;
    order.collDelta = -3;
    order.debtDelta = -2;
    order.nonce = 0;
    order.salt = bytes32(uint256(2));
    order.deadline = block.timestamp + 1 days;

    (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) = limitOrderManager
      .getOrderDetails(order);
    assertEq(makingToken, address(collateralToken), "makingToken should be collateral for close long");
    assertEq(takingToken, address(fxUSD), "takingToken should be fxUSD for close long");
    assertEq(makingAmount, OrderLibrary.getMakingAmount(order));
    assertEq(takingAmount, OrderLibrary.getTakingAmount(order));
  }

  function testGetOrderDetails_OpenShort() public {
    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(shortPool);
    order.positionId = 0;
    order.positionSide = false; // short
    order.orderSide = true; // open
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = 2;
    order.collDelta = 10;
    order.debtDelta = 5;
    order.nonce = 0;
    order.salt = bytes32(uint256(3));
    order.deadline = block.timestamp + 1 days;

    (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) = limitOrderManager
      .getOrderDetails(order);
    assertEq(makingToken, address(collateralToken), "makingToken should be debt token for open short");
    assertEq(takingToken, address(fxUSD), "takingToken should be fxUSD for open short");
    assertEq(makingAmount, OrderLibrary.getMakingAmount(order));
    assertEq(takingAmount, OrderLibrary.getTakingAmount(order));
  }

  function testGetOrderDetails_CloseShort() public {
    OrderLibrary.Order memory order;
    order.maker = maker;
    order.pool = address(shortPool);
    order.positionId = 0;
    order.positionSide = false; // short
    order.orderSide = false; // close
    order.allowPartialFill = true;
    order.triggerPrice = 0;
    order.fxUSDDelta = -3;
    order.collDelta = -6;
    order.debtDelta = -5;
    order.nonce = 0;
    order.salt = bytes32(uint256(4));
    order.deadline = block.timestamp + 1 days;

    (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) = limitOrderManager
      .getOrderDetails(order);
    assertEq(makingToken, address(fxUSD), "makingToken should be fxUSD for close short");
    assertEq(takingToken, address(collateralToken), "takingToken should be debt token for close short");
    assertEq(makingAmount, OrderLibrary.getMakingAmount(order));
    assertEq(takingAmount, OrderLibrary.getTakingAmount(order));
  }

  function testUpdateTreasury_RevertNonAdmin() public {
    address nonAdmin = makeAddr("nonAdmin");
    // ensure nonAdmin is whitelisted like other actors if required elsewhere
    whitelist.approveWallet(nonAdmin);

    vm.startPrank(nonAdmin);
    // OpenZeppelin AccessControlUpgradeable reverts with AccessControlUnauthorizedAccount(account, role)
    vm.expectRevert(abi.encodeWithSignature("AccessControlUnauthorizedAccount(address,bytes32)", nonAdmin, bytes32(0)));
    limitOrderManager.updateTreasury(makeAddr("newTreasury1"));
    vm.stopPrank();
  }

  function testUpdateTreasury_EmitsAndUpdates() public {
    address oldTreasury = treasury;
    address newTreasury = makeAddr("newTreasury2");

    vm.expectEmit(true, true, false, true);
    emit ILimitOrderManager.UpdateTreasury(oldTreasury, newTreasury);
    limitOrderManager.updateTreasury(newTreasury);

    assertEq(limitOrderManager.treasury(), newTreasury);
  }

  function testUpdateTreasury_AllowZeroAddress() public {
    // set to zero address is allowed by implementation
    vm.expectEmit(true, true, false, true);
    emit ILimitOrderManager.UpdateTreasury(treasury, address(0));
    limitOrderManager.updateTreasury(address(0));
    assertEq(limitOrderManager.treasury(), address(0));

    // can update again to a non-zero address
    address newTreasury = makeAddr("newTreasury3");
    vm.expectEmit(true, true, false, true);
    emit ILimitOrderManager.UpdateTreasury(address(0), newTreasury);
    limitOrderManager.updateTreasury(newTreasury);
    assertEq(limitOrderManager.treasury(), newTreasury);
  }
}
