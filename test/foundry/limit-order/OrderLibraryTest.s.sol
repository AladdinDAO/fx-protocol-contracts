// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { Test } from "forge-std/Test.sol";
import { OrderLibrary } from "contracts/limit-order/OrderLibrary.sol";

contract OrderLibraryHarness {
  using OrderLibrary for OrderLibrary.Order;

  function validateOrderPublic(OrderLibrary.Order memory order) external view {
    OrderLibrary.validateOrder(order);
  }

  function getMakingTokenPublic(OrderLibrary.Order memory order) external view returns (address) {
    return OrderLibrary.getMakingToken(order);
  }

  function getTakingTokenPublic(OrderLibrary.Order memory order) external view returns (address) {
    return OrderLibrary.getTakingToken(order);
  }

  function getMakingAmountPublic(OrderLibrary.Order memory order) external pure returns (uint256) {
    return OrderLibrary.getMakingAmount(order);
  }

  function getTakingAmountPublic(OrderLibrary.Order memory order) external pure returns (uint256) {
    return OrderLibrary.getTakingAmount(order);
  }
}

contract MockOracle {
  uint256 public anchorPrice;
  uint256 public minPrice;
  uint256 public maxPrice;

  constructor(uint256 _anchor, uint256 _min, uint256 _max) {
    anchorPrice = _anchor;
    minPrice = _min;
    maxPrice = _max;
  }

  function setPrices(uint256 _anchor, uint256 _min, uint256 _max) external {
    anchorPrice = _anchor;
    minPrice = _min;
    maxPrice = _max;
  }

  function getPrice() external view returns (uint256, uint256, uint256) {
    return (anchorPrice, minPrice, maxPrice);
  }
}

contract MockLongPool {
  address public fxUSD;
  address public collateral;
  address public oracle;

  constructor(address _fxUSD, address _collateral, address _oracle) {
    fxUSD = _fxUSD;
    collateral = _collateral;
    oracle = _oracle;
  }

  function collateralToken() external view returns (address) {
    return collateral;
  }

  function priceOracle() external view returns (address) {
    return oracle;
  }
}

contract MockShortPool {
  address public fxUSD;
  address public debt;
  address public oracle;

  constructor(address _fxUSD, address _debt, address _oracle) {
    fxUSD = _fxUSD;
    debt = _debt;
    oracle = _oracle;
  }

  function debtToken() external view returns (address) {
    return debt;
  }

  function priceOracle() external view returns (address) {
    return oracle;
  }
}

contract OrderLibraryTest is Test {
  OrderLibraryHarness internal harness;
  MockOracle internal oracle;
  MockLongPool internal longPool;
  MockShortPool internal shortPool;

  address internal constant FXUSD = 0x085780639CC2cACd35E474e71f4d000e2405d8f6;
  address internal collateralToken = address(0xC011A1);
  address internal debtToken = address(0xD011A1);

  function setUp() public {
    oracle = new MockOracle(1e18, 100e18, 100e18);
    longPool = new MockLongPool(FXUSD, collateralToken, address(oracle));
    shortPool = new MockShortPool(FXUSD, debtToken, address(oracle));
    harness = new OrderLibraryHarness();
  }

  function _baseOrder(bool positionSide, bool orderSide) internal view returns (OrderLibrary.Order memory o) {
    o.maker = address(this);
    o.pool = positionSide ? address(longPool) : address(shortPool);
    o.positionId = 0;
    o.positionSide = positionSide; // long
    o.orderSide = orderSide; // open
    o.allowPartialFill = true;
    o.triggerPrice = 0;
    o.fxUSDDelta = 0;
    o.collDelta = 0;
    o.debtDelta = 0;
    o.nonce = 0;
    o.salt = bytes32(uint256(123));
    o.deadline = block.timestamp + 1 days;
  }

  // validateOrder: sign checks for long open
  function test_validateOrder_LongOpen_SignsOK() public view {
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.fxUSDDelta = 1;
    o.collDelta = 2;
    o.debtDelta = 3;
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_LongOpen_NegativeFxUSD_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.fxUSDDelta = -1;
    vm.expectRevert(OrderLibrary.ErrNegativeValue.selector);
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_LongOpen_NegativeDebt_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.debtDelta = -1;
    vm.expectRevert(OrderLibrary.ErrNegativeValue.selector);
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_LongOpen_NegativeColl_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.collDelta = -1;
    vm.expectRevert(OrderLibrary.ErrNegativeValue.selector);
    harness.validateOrderPublic(o);
  }

  // validateOrder: sign checks for long close
  function test_validateOrder_LongClose_SignsOK() public view {
    OrderLibrary.Order memory o = _baseOrder(true, false);
    o.fxUSDDelta = -1;
    o.collDelta = -2;
    o.debtDelta = -3;
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_LongClose_PositiveFxUSD_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(true, false);
    o.fxUSDDelta = 1;
    vm.expectRevert(OrderLibrary.ErrPositiveValue.selector);
    harness.validateOrderPublic(o);
  }

  // validateOrder: sign checks for short open
  function test_validateOrder_ShortOpen_SignsOK() public view {
    OrderLibrary.Order memory o = _baseOrder(false, true);
    o.fxUSDDelta = 1;
    o.collDelta = 2;
    o.debtDelta = 3;
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_ShortOpen_NegativeAny_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(false, true);
    o.fxUSDDelta = -1;
    vm.expectRevert(OrderLibrary.ErrNegativeValue.selector);
    harness.validateOrderPublic(o);
  }

  // validateOrder: sign checks for short close
  function test_validateOrder_ShortClose_SignsOK() public view {
    OrderLibrary.Order memory o = _baseOrder(false, false);
    o.fxUSDDelta = -1;
    o.collDelta = -2;
    o.debtDelta = -3;
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_ShortClose_PositiveAny_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(false, false);
    o.collDelta = 1;
    vm.expectRevert(OrderLibrary.ErrPositiveValue.selector);
    harness.validateOrderPublic(o);
  }

  // validateOrder: deadline
  function test_validateOrder_Expired_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.deadline = block.timestamp - 1;
    vm.expectRevert(OrderLibrary.ErrOrderExpired.selector);
    harness.validateOrderPublic(o);
  }

  // validateOrder: oracle trigger conditions
  function test_validateOrder_BuyOrder_TriggerTooLow_Reverts() public {
    // anchor = 100
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.triggerPrice = 99e18; // buy requires trigger >= anchor
    vm.expectRevert(OrderLibrary.ErrOrderCannotBeTriggered.selector);
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_BuyOrder_TriggerOK_Passes() public view {
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.triggerPrice = 100e18;
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_SellOrder_TriggerTooHigh_Reverts() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(true, false);
    o.triggerPrice = 101e18; // sell requires trigger <= anchor
    vm.expectRevert(OrderLibrary.ErrOrderCannotBeTriggered.selector);
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_SellOrder_TriggerOK_Passes() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(true, false);
    o.triggerPrice = 100e18;
    harness.validateOrderPublic(o);
  }

  // getMakingToken / getTakingToken
  function test_Tokens_LongOpen() public view {
    OrderLibrary.Order memory o = _baseOrder(true, true); // long open
    assertEq(harness.getMakingTokenPublic(o), FXUSD, "making token long open");
    assertEq(harness.getTakingTokenPublic(o), collateralToken, "taking token long open");
  }

  function test_Tokens_LongClose() public view {
    OrderLibrary.Order memory o = _baseOrder(true, false);
    assertEq(harness.getMakingTokenPublic(o), collateralToken, "making token long close");
    assertEq(harness.getTakingTokenPublic(o), FXUSD, "taking token long close");
  }

  function test_Tokens_ShortOpen() public view {
    OrderLibrary.Order memory o = _baseOrder(false, true);
    assertEq(harness.getMakingTokenPublic(o), debtToken, "making token short open");
    assertEq(harness.getTakingTokenPublic(o), FXUSD, "taking token short open");
  }

  function test_Tokens_ShortClose() public view {
    OrderLibrary.Order memory o = _baseOrder(false, false);
    assertEq(harness.getMakingTokenPublic(o), FXUSD, "making token short close");
    assertEq(harness.getTakingTokenPublic(o), debtToken, "taking token short close");
  }

  // getMakingAmount / getTakingAmount
  function test_Amounts_LongOpen() public view {
    OrderLibrary.Order memory o = _baseOrder(true, true); // long open
    o.fxUSDDelta = 10;
    o.debtDelta = 5;
    o.collDelta = 7;
    assertEq(harness.getMakingAmountPublic(o), 15, "making amount long open");
    assertEq(harness.getTakingAmountPublic(o), 7, "taking amount long open");
  }

  function test_Amounts_LongClose() public view {
    OrderLibrary.Order memory o = _baseOrder(true, false);
    o.fxUSDDelta = -8;
    o.debtDelta = -2;
    o.collDelta = -6;
    assertEq(harness.getMakingAmountPublic(o), 6, "making amount long close");
    assertEq(harness.getTakingAmountPublic(o), 10, "taking amount long close");
  }

  function test_Amounts_ShortOpen() public view {
    OrderLibrary.Order memory o = _baseOrder(false, true);
    o.fxUSDDelta = 4;
    o.debtDelta = 9;
    o.collDelta = 10;
    assertEq(harness.getMakingAmountPublic(o), 9, "making amount short open");
    assertEq(harness.getTakingAmountPublic(o), 6, "taking amount short open");
  }

  function test_Amounts_ShortOpen_BadDelta_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(false, true);
    o.fxUSDDelta = 10;
    o.collDelta = 5; // coll - fxUSD negative
    vm.expectRevert(OrderLibrary.ErrNegativeValue.selector);
    harness.getTakingAmountPublic(o);
  }

  function test_Amounts_ShortClose() public view {
    OrderLibrary.Order memory o = _baseOrder(false, false);
    o.fxUSDDelta = -3;
    o.debtDelta = -7;
    o.collDelta = -12;
    assertEq(harness.getMakingAmountPublic(o), 9, "making amount short close"); // fxUSDDelta - collDelta = -12 - (-3) = -9 -> ensureNonNegative applied before casting in making amount path, but here positionSide=false && orderSide=false => delta = coll - fxUSD = -3 - (-12) = 9, matching 9
    assertEq(harness.getTakingAmountPublic(o), 7, "taking amount short close");
  }

  function test_Amounts_ShortClose_BadDelta_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(false, false);
    o.fxUSDDelta = -10;
    o.collDelta = -3; // coll - fxUSD = -10 - (-3) = -7 -> making amount path ensures non-negative
    vm.expectRevert(OrderLibrary.ErrNegativeValue.selector);
    harness.getMakingAmountPublic(o);
  }

  // ========== Stop Orders (orderType=true) Tests ==========

  // Long Take Profit Orders (orderType=true, orderSide=true, positionSide=true)
  function test_validateOrder_LongTakeProfit_SignsOK() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.orderType = true; // stop order
    o.triggerPrice = 100e18;
    o.fxUSDDelta = -1;
    o.collDelta = -2;
    o.debtDelta = -3;
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_LongTakeProfit_PositiveFxUSD_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.orderType = true; // stop order
    o.fxUSDDelta = 1; // positive value should revert for stop orders
    vm.expectRevert(OrderLibrary.ErrPositiveValue.selector);
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_LongTakeProfit_PositiveColl_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.orderType = true; // stop order
    o.collDelta = 1; // positive value should revert for stop orders
    vm.expectRevert(OrderLibrary.ErrPositiveValue.selector);
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_LongTakeProfit_PositiveDebt_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.orderType = true; // stop order
    o.debtDelta = 1; // positive value should revert for stop orders
    vm.expectRevert(OrderLibrary.ErrPositiveValue.selector);
    harness.validateOrderPublic(o);
  }

  // Long Stop Loss Orders (orderType=true, orderSide=false, positionSide=true)
  function test_validateOrder_LongStopLoss_SignsOK() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(true, false);
    o.orderType = true; // stop order
    o.triggerPrice = 100e18;
    o.fxUSDDelta = -1;
    o.collDelta = -2;
    o.debtDelta = -3;
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_LongStopLoss_PositiveFxUSD_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(true, false);
    o.orderType = true; // stop order
    o.triggerPrice = 100e18;
    o.fxUSDDelta = 1; // positive value should revert for stop orders
    vm.expectRevert(OrderLibrary.ErrPositiveValue.selector);
    harness.validateOrderPublic(o);
  }

  // Short Take Profit Orders (orderType=true, orderSide=true, positionSide=false)
  function test_validateOrder_ShortTakeProfit_SignsOK() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(false, true);
    o.orderType = true; // stop order
    o.triggerPrice = 100e18;
    o.fxUSDDelta = -1;
    o.collDelta = -2;
    o.debtDelta = -3;
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_ShortTakeProfit_PositiveFxUSD_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(false, true);
    o.orderType = true; // stop order
    o.fxUSDDelta = 1; // positive value should revert for stop orders
    vm.expectRevert(OrderLibrary.ErrPositiveValue.selector);
    harness.validateOrderPublic(o);
  }

  // Short Stop Loss Orders (orderType=true, orderSide=false, positionSide=false)
  function test_validateOrder_ShortStopLoss_SignsOK() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(false, false);
    o.orderType = true; // stop order
    o.triggerPrice = 100e18;
    o.fxUSDDelta = -1;
    o.collDelta = -2;
    o.debtDelta = -3;
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_ShortStopLoss_PositiveFxUSD_Reverts() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(false, false);
    o.orderType = true; // stop order
    o.fxUSDDelta = 1; // positive value should revert for stop orders
    vm.expectRevert(OrderLibrary.ErrPositiveValue.selector);
    harness.validateOrderPublic(o);
  }

  // Stop Order Trigger Price Validation
  function test_validateOrder_LongTakeProfit_TriggerTooHigh_Reverts() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.orderType = true; // stop order
    o.triggerPrice = 101e18; // take profit requires trigger <= anchor
    vm.expectRevert(OrderLibrary.ErrOrderCannotBeTriggered.selector);
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_LongTakeProfit_TriggerOK_Passes() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.orderType = true; // stop order
    o.triggerPrice = 100e18;
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_LongStopLoss_TriggerTooLow_Reverts() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(true, false);
    o.orderType = true; // stop order
    o.triggerPrice = 99e18; // stop loss requires trigger >= anchor
    vm.expectRevert(OrderLibrary.ErrOrderCannotBeTriggered.selector);
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_LongStopLoss_TriggerOK_Passes() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(true, false);
    o.orderType = true; // stop order
    o.triggerPrice = 100e18;
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_ShortTakeProfit_TriggerTooLow_Reverts() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(false, true);
    o.orderType = true; // stop order
    o.triggerPrice = 101e18; // take profit requires trigger >= anchor
    vm.expectRevert(OrderLibrary.ErrOrderCannotBeTriggered.selector);
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_ShortTakeProfit_TriggerOK_Passes() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(false, true);
    o.orderType = true; // stop order
    o.triggerPrice = 100e18;
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_ShortStopLoss_TriggerTooHigh_Reverts() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(false, false);
    o.orderType = true; // stop order
    o.triggerPrice = 99e18; // stop loss requires trigger <= anchor
    vm.expectRevert(OrderLibrary.ErrOrderCannotBeTriggered.selector);
    harness.validateOrderPublic(o);
  }

  function test_validateOrder_ShortStopLoss_TriggerOK_Passes() public {
    oracle.setPrices(100e18, 100e18, 100e18);
    OrderLibrary.Order memory o = _baseOrder(false, false);
    o.orderType = true; // stop order
    o.triggerPrice = 100e18;
    harness.validateOrderPublic(o);
  }

  // Stop Order Token Tests
  function test_Tokens_LongTakeProfit() public view {
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.orderType = true; // stop order
    assertEq(harness.getMakingTokenPublic(o), collateralToken, "making token long take profit");
    assertEq(harness.getTakingTokenPublic(o), FXUSD, "taking token long take profit");
  }

  function test_Tokens_LongStopLoss() public view {
    OrderLibrary.Order memory o = _baseOrder(true, false);
    o.orderType = true; // stop order
    assertEq(harness.getMakingTokenPublic(o), collateralToken, "making token long stop loss");
    assertEq(harness.getTakingTokenPublic(o), FXUSD, "taking token long stop loss");
  }

  function test_Tokens_ShortTakeProfit() public view {
    OrderLibrary.Order memory o = _baseOrder(false, true);
    o.orderType = true; // stop order
    assertEq(harness.getMakingTokenPublic(o), FXUSD, "making token short take profit");
    assertEq(harness.getTakingTokenPublic(o), debtToken, "taking token short take profit");
  }

  function test_Tokens_ShortStopLoss() public view {
    OrderLibrary.Order memory o = _baseOrder(false, false);
    o.orderType = true; // stop order
    assertEq(harness.getMakingTokenPublic(o), FXUSD, "making token short stop loss");
    assertEq(harness.getTakingTokenPublic(o), debtToken, "taking token short stop loss");
  }

  // Stop Order Amount Tests
  function test_Amounts_LongTakeProfit() public view {
    OrderLibrary.Order memory o = _baseOrder(true, true);
    o.orderType = true; // stop order
    o.fxUSDDelta = -8;
    o.debtDelta = -2;
    o.collDelta = -6;
    assertEq(harness.getMakingAmountPublic(o), 6, "making amount long take profit"); // -collDelta = -(-6) = 6
    assertEq(harness.getTakingAmountPublic(o), 10, "taking amount long take profit"); // -(fxUSDDelta + debtDelta) = -(-8 + -2) = 10
  }

  function test_Amounts_LongStopLoss() public view {
    OrderLibrary.Order memory o = _baseOrder(true, false);
    o.orderType = true; // stop order
    o.fxUSDDelta = -5;
    o.debtDelta = -1;
    o.collDelta = -4;
    assertEq(harness.getMakingAmountPublic(o), 4, "making amount long stop loss"); // -collDelta = -(-4) = 4
    assertEq(harness.getTakingAmountPublic(o), 6, "taking amount long stop loss"); // -(fxUSDDelta + debtDelta) = -(-5 + -1) = 6
  }

  function test_Amounts_ShortTakeProfit() public view {
    OrderLibrary.Order memory o = _baseOrder(false, true);
    o.orderType = true; // stop order
    o.fxUSDDelta = -3;
    o.debtDelta = -7;
    o.collDelta = -12;
    assertEq(harness.getMakingAmountPublic(o), 9, "making amount short take profit"); // fxUSDDelta - collDelta = -3 - (-12) = 9
    assertEq(harness.getTakingAmountPublic(o), 7, "taking amount short take profit"); // -debtDelta = -(-7) = 7
  }

  function test_Amounts_ShortStopLoss() public view {
    OrderLibrary.Order memory o = _baseOrder(false, false);
    o.orderType = true; // stop order
    o.fxUSDDelta = -5;
    o.debtDelta = -3;
    o.collDelta = -10; // fxUSDDelta - collDelta = -5 - (-10) = 5, should be fine
    assertEq(harness.getMakingAmountPublic(o), 5, "making amount short stop loss"); // fxUSDDelta - collDelta = -5 - (-10) = 5
    assertEq(harness.getTakingAmountPublic(o), 3, "taking amount short stop loss"); // -debtDelta = -(-3) = 3
  }

  function test_Amounts_ShortStopLoss_GoodDelta_Passes() public view {
    OrderLibrary.Order memory o = _baseOrder(false, false);
    o.orderType = true; // stop order
    o.fxUSDDelta = -5;
    o.collDelta = -10; // fxUSDDelta - collDelta = -5 - (-10) = 5, should be fine
    o.debtDelta = -2;
    // This should not revert as 5 > 0
    harness.getMakingAmountPublic(o);
  }

  function test_Amounts_ShortStopLoss_BadDelta_Reverts() public {
    OrderLibrary.Order memory o = _baseOrder(false, false);
    o.orderType = true; // stop order
    o.fxUSDDelta = -10;
    o.collDelta = -5; // fxUSDDelta - collDelta = -10 - (-5) = -5, should revert
    o.debtDelta = -2;
    vm.expectRevert(OrderLibrary.ErrNegativeValue.selector);
    harness.getMakingAmountPublic(o);
  }
}
