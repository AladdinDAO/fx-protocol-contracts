// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IPriceOracle } from "../price-oracle/interfaces/IPriceOracle.sol";
import { IPool } from "../interfaces/IPool.sol";
import { ILongPool } from "../interfaces/ILongPool.sol";
import { IShortPool } from "../interfaces/IShortPool.sol";

/// @dev We have eight cases for order:
/// 1. open long
///    - orderType: false
///    - orderSide: true
///    - positionSide: true
///    - fxUSDDelta: positive or zero
///    - collDelta: positive or zero
///    - debtDelta: positive or zero
///    - making token: fxUSD
///    - taking token: collateral
///    - making amount: fxUSDDelta + debtDelta
///    - taking amount: collDelta
/// 2. close long
///    - orderType: false
///    - orderSide: false
///    - positionSide: true
///    - fxUSDDelta: negative or zero
///    - collDelta: negative or zero
///    - debtDelta: negative or zero
///    - making token: collateral
///    - taking token: fxUSD
///    - making amount: -collDelta
///    - taking amount: -(fxUSDDelta + debtDelta)
/// 3. open short
///    - orderType: false
///    - orderSide: true
///    - positionSide: false
///    - fxUSDDelta: positive or zero
///    - collDelta: positive or zero
///    - debtDelta: positive or zero
///    - making token: collateral
///    - taking token: fxUSD
///    - making amount: debtDelta
///    - taking amount: collDelta - fxUSDDelta
/// 4. close short
///    - orderType: false
///    - orderSide: false
///    - positionSide: false
///    - fxUSDDelta: negative or zero
///    - collDelta: negative or zero
///    - debtDelta: negative or zero
///    - making token: fxUSD
///    - taking token: collateral
///    - making amount: fxUSDDelta - collDelta
///    - taking amount: -debtDelta
/// 5. long take profit
///    - orderType: true
///    - orderSide: true
///    - positionSide: true
///    - fxUSDDelta: negative or zero
///    - collDelta: negative or zero
///    - debtDelta: negative or zero
///    - making token: collateral
///    - taking token: fxUSD
///    - making amount: -collDelta
///    - taking amount: -(fxUSDDelta + debtDelta)
/// 6. long stop loss
///    - orderType: true
///    - orderSide: false
///    - positionSide: true
///    - fxUSDDelta: negative or zero
///    - collDelta: negative or zero
///    - debtDelta: negative or zero
///    - making token: collateral
///    - taking token: fxUSD
///    - making amount: -collDelta
///    - taking amount: -(fxUSDDelta + debtDelta)
/// 7. short take profit
///    - orderType: true
///    - orderSide: true
///    - positionSide: false
///    - fxUSDDelta: negative or zero
///    - collDelta: negative or zero
///    - debtDelta: negative or zero
///    - making token: fxUSD
///    - taking token: collateral
///    - making amount: fxUSDDelta - collDelta
///    - taking amount: -debtDelta
/// 8. short stop loss
///    - orderType: true
///    - orderSide: false
///    - positionSide: false
///    - fxUSDDelta: negative or zero
///    - collDelta: negative or zero
///    - debtDelta: negative or zero
///    - making token: fxUSD
///    - taking token: collateral
///    - making amount: fxUSDDelta - collDelta
///    - taking amount: -debtDelta
library OrderLibrary {
  /**********
   * Errors *
   **********/

  /// @dev Thrown when the value is negative.
  error ErrNegativeValue();

  /// @dev Thrown when the value is positive.
  error ErrPositiveValue();

  /// @dev Thrown when the order is expired.
  error ErrOrderExpired();

  /// @dev Thrown when the trigger price is zero on stop order.
  error ErrZeroTriggerPriceOnStopOrder();

  /// @dev Thrown when the order cannot be triggered (trigger price not match with oracle price).
  error ErrOrderCannotBeTriggered();

  /*************
   * Constants *
   *************/

  /// @dev The typehash of the order.
  bytes32 internal constant LIMIT_ORDER_TYPEHASH =
    keccak256(
      "Order(address maker,address pool,uint256 positionId,bool positionSide,bool orderType,bool orderSide,bool allowPartialFill,uint256 triggerPrice,int256 fxUSDDelta,int256 collDelta,int256 debtDelta,uint256 nonce,bytes32 salt,uint256 deadline)"
    );

  /***********
   * Structs *
   ***********/

  /// @dev The order struct.
  /// @param maker The maker of the order.
  /// @param pool The pool of the order.
  /// @param positionId The id of the position.
  /// @param positionSide The side of the position.
  /// @param orderSide The side of the order.
  /// @param allowPartialFill Whether the order allows partial fill.
  /// @param triggerPrice The trigger price of the order.
  /// @param fxUSDDelta The fxUSD delta of the order.
  /// @param collDelta The collateral delta of the order.
  /// @param debtDelta The debt delta of the order.
  /// @param nonce The nonce of the order. The nonce is a helper field for the maker to easily batch cancel the orders.
  /// @param salt The salt of the order. The salt is used to make the order hash unique.
  /// @param deadline The deadline of the order in seconds. The order is expired if the deadline is less than the current block timestamp.
  struct Order {
    address maker;
    address pool;
    uint256 positionId;
    bool positionSide; // true for long, false for short
    // false for limit order
    //   orderSide = true: open order, order can be filled only oracle price is <= triggerPrice
    //   orderSide = false: close order, order can be filled only oracle price is >= triggerPrice
    // true for stop order
    //   allways close order
    //   orderSide = true: take profit order, order can be filled only oracle price is >= triggerPrice
    //   orderSide = false: stop loss order, order can be filled only oracle price is <= triggerPrice
    bool orderType;
    bool orderSide;
    bool allowPartialFill; // true for partial fill, false for full fill
    uint256 triggerPrice;
    int256 fxUSDDelta; // positive: take from maker, negative: give to maker
    int256 collDelta; // collateral delta passing to the corresponding pool manager
    int256 debtDelta; // debt delta passing to the corresponding pool manager
    uint256 nonce; 
    bytes32 salt;
    uint256 deadline;
  }

  /****************************
   * Internal View Functions *
   ****************************/

  /// @dev Ensure the value is non-negative.
  function ensureNonNegative(int256 value) private pure {
    if (value < 0) revert ErrNegativeValue();
  }

  /// @dev Ensure the value is non-positive.
  function ensureNonPositive(int256 value) private pure {
    if (value > 0) revert ErrPositiveValue();
  }

  /// @dev Validate the order.
  function validateOrder(Order memory order) internal view {
    // check basic fields
    if (order.orderType) {
      // always close order
      ensureNonPositive(order.fxUSDDelta);
      ensureNonPositive(order.debtDelta);
      ensureNonPositive(order.collDelta);
      if (order.triggerPrice == 0) revert ErrZeroTriggerPriceOnStopOrder();
    } else {
      if (order.positionSide) {
        if (order.orderSide) {
          ensureNonNegative(order.fxUSDDelta);
          ensureNonNegative(order.debtDelta);
          ensureNonNegative(order.collDelta);
        } else {
          ensureNonPositive(order.fxUSDDelta);
          ensureNonPositive(order.debtDelta);
          ensureNonPositive(order.collDelta);
        }
      } else {
        if (order.orderSide) {
          ensureNonNegative(order.fxUSDDelta);
          ensureNonNegative(order.debtDelta);
          ensureNonNegative(order.collDelta);
        } else {
          ensureNonPositive(order.fxUSDDelta);
          ensureNonPositive(order.debtDelta);
          ensureNonPositive(order.collDelta);
        }
      }
    }

    // check oracle price
    if (order.triggerPrice != 0) {
      address oracle = IPool(order.pool).priceOracle();
      (uint256 anchorPrice, , ) = IPriceOracle(oracle).getPrice();
      if (order.orderType) {
        if (order.orderSide) {
          // for take profit order, oracle price should >= trigger price
          if (order.triggerPrice > anchorPrice) revert ErrOrderCannotBeTriggered();
        } else {
          // for stop loss order, oracle price should <= trigger price
          if (order.triggerPrice < anchorPrice) revert ErrOrderCannotBeTriggered();
        }
      } else {
        if (order.orderSide) {
          // for buy order, oracle price should <= trigger price
          if (order.triggerPrice < anchorPrice) revert ErrOrderCannotBeTriggered();
        } else {
          // for sell order, oracle price should >= trigger price
          if (order.triggerPrice > anchorPrice) revert ErrOrderCannotBeTriggered();
        }
      }
    }

    // check deadline
    if (order.deadline < block.timestamp) revert ErrOrderExpired();
  }

  /// @dev Get the making token of the order.
  /// @param order The order.
  /// @return The making token.
  function getMakingToken(Order memory order) internal view returns (address) {
    if (order.orderType) {
      if (order.positionSide) {
        return ILongPool(order.pool).collateralToken();
      } else {
        return IPool(order.pool).fxUSD();
      }
    } else {
      if (order.orderSide == order.positionSide) {
        return IPool(order.pool).fxUSD();
      } else if (order.positionSide) {
        return ILongPool(order.pool).collateralToken();
      } else {
        return IShortPool(order.pool).debtToken();
      }
    }
  }

  /// @dev Get the taking token of the order.
  /// @param order The order.
  /// @return The taking token.
  function getTakingToken(Order memory order) internal view returns (address) {
    if (order.orderType) {
      if (order.positionSide) {
        return IPool(order.pool).fxUSD();
      } else {
        return IShortPool(order.pool).debtToken();
      }
    } else {
      if (order.orderSide != order.positionSide) {
        return IPool(order.pool).fxUSD();
      } else if (order.positionSide) {
        return ILongPool(order.pool).collateralToken();
      } else {
        return IShortPool(order.pool).debtToken();
      }
    }
  }

  /// @dev Get the making amount of the order.
  /// @param order The order.
  /// @return The making amount.
  function getMakingAmount(Order memory order) internal pure returns (uint256) {
    if (order.orderType) {
      if (order.positionSide) {
        return uint256(-order.collDelta);
      } else {
        int256 delta = -order.collDelta + order.fxUSDDelta;
        ensureNonNegative(delta);
        return uint256(delta);
      }
    } else {
      if (order.positionSide) {
        if (order.orderSide) {
          return uint256(order.fxUSDDelta + order.debtDelta);
        } else {
          return uint256(-order.collDelta);
        }
      } else {
        if (order.orderSide) {
          return uint256(order.debtDelta);
        } else {
          int256 delta = -order.collDelta + order.fxUSDDelta;
          ensureNonNegative(delta);
          return uint256(delta);
        }
      }
    }
  }

  /// @dev Get the taking amount of the order.
  /// @param order The order.
  /// @return The taking amount.
  function getTakingAmount(Order memory order) internal pure returns (uint256) {
    if (order.orderType) {
      if (order.positionSide) {
        return uint256(-order.fxUSDDelta - order.debtDelta);
      } else {
        return uint256(-order.debtDelta);
      }
    } else {
      if (order.positionSide) {
        if (order.orderSide) {
          return uint256(order.collDelta);
        } else {
          return uint256(-order.fxUSDDelta - order.debtDelta);
        }
      } else {
        if (order.orderSide) {
          int256 delta = order.collDelta - order.fxUSDDelta;
          ensureNonNegative(delta);
          return uint256(delta);
        } else {
          return uint256(-order.debtDelta);
        }
      }
    }
  }
}
