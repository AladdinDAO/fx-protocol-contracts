// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { EIP712Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import { NoncesUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/NoncesUpgradeable.sol";

import { Math } from "../libraries/Math.sol";
import { OrderExecutionLibrary } from "./OrderExecutionLibrary.sol";
import { OrderLibrary } from "./OrderLibrary.sol";

import { IPoolManager } from "../interfaces/IPoolManager.sol";
import { IPool } from "../interfaces/IPool.sol";
import { ILimitOrderManager } from "./ILimitOrderManager.sol";

contract LimitOrderManager is
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  NoncesUpgradeable,
  EIP712Upgradeable,
  ILimitOrderManager
{
  using OrderLibrary for OrderLibrary.Order;
  using OrderExecutionLibrary for bytes32;
  using SafeERC20 for IERC20;

  /**********
   * Errors *
   **********/

  /// @dev Thrown when the order nonce is expired.
  error ErrOrderNonceExpired();

  /// @dev Thrown when the order is cancelled.
  error ErrOrderCancelled();

  /// @dev Thrown when the order is fully filled.
  error ErrOrderCancelledOrFullyFilled();

  /// @dev Thrown when the order cannot be fully filled.
  error ErrOrderCannotBeFullyFilled();

  /// @dev Thrown when the making amount is insufficient.
  error ErrInsufficientMakingAmount();

  /// @dev Thrown when the taking amount is insufficient.
  error ErrTakingAmountAboveRemaining();

  /// @dev Thrown when the signature is bad.
  error ErrBadSignature();

  /// @dev Thrown when the caller is not the maker.
  error ErrNotMaker();

  /// @dev Thrown when the order is already cancelled.
  error ErrOrderAlreadyCancelled();

  /// @dev Thrown when the order is already filled.
  error ErrOrderAlreadyFilled();

  /*************
   * Constants *
   *************/

  /// @dev The address of `LongPoolManager`.
  address private immutable LongPoolManager;

  /// @dev The address of `ShortPoolManager`.
  address private immutable ShortPoolManager;

  /// @dev The address of `fxUSD`.
  address private immutable fxUSD;

  /*************
   * Variables *
   *************/

  /// @dev The execution of the order.
  mapping(bytes32 => bytes32) private executions;

  /// @notice The address of `treasury`.
  address public treasury;

  /***************
   * Constructor *
   ***************/

  constructor(address _LongPoolManager, address _ShortPoolManager, address _fxUSD) {
    LongPoolManager = _LongPoolManager;
    ShortPoolManager = _ShortPoolManager;
    fxUSD = _fxUSD;
  }

  /// @notice Initialize the contract.
  function initialize(address admin, address _treasury) external initializer {
    __AccessControl_init();
    __ReentrancyGuard_init();
    __Nonces_init();
    __EIP712_init("f(x) Limit Order Manager", "1");

    _grantRole(DEFAULT_ADMIN_ROLE, admin);

    _updateTreasury(_treasury);
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Get the hash of the order.
  /// @param order The order struct.
  /// @return The hash of the order.
  function getOrderHash(OrderLibrary.Order memory order) external view returns (bytes32) {
    return _hash(order);
  }

  /// @inheritdoc ILimitOrderManager
  function getOrderDetails(
    OrderLibrary.Order memory order
  ) external view returns (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount) {
    return (order.getMakingToken(), order.getTakingToken(), order.getMakingAmount(), order.getTakingAmount());
  }

  /// @inheritdoc ILimitOrderManager
  function getExecution(bytes32 orderHash) external view returns (OrderExecutionLibrary.Execution memory) {
    return executions[orderHash].decode();
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc ILimitOrderManager
  function increaseNonce() external {
    uint256 nonce = _useNonce(_msgSender());

    emit AdvanceNonce(_msgSender(), nonce);
  }

  /// @inheritdoc ILimitOrderManager
  function fillOrder(
    OrderLibrary.Order memory order,
    bytes memory signature,
    uint256 makingAmount,
    uint256 takingAmount
  ) external nonReentrant {
    // validate basic fields of the order.
    order.validateOrder();

    // check signature and nonce.
    bytes32 orderHash = _hash(order);
    _checkSignature(order, orderHash, signature);
    if (order.nonce != nonces(order.maker)) revert ErrOrderNonceExpired();

    // check order status
    OrderExecutionLibrary.Execution memory execution = executions[orderHash].decode();
    if (
      execution.status != OrderExecutionLibrary.Status.New &&
      execution.status != OrderExecutionLibrary.Status.PartialFilled
    ) {
      revert ErrOrderCancelledOrFullyFilled();
    }

    // check making amount and taking amount.
    uint256 orderMakingAmount = order.getMakingAmount();
    uint256 orderTakingAmount = order.getTakingAmount();
    if (!order.allowPartialFill) {
      if (takingAmount < orderMakingAmount || makingAmount < orderTakingAmount) {
        revert ErrOrderCannotBeFullyFilled();
      }
    }
    if (takingAmount > orderMakingAmount - execution.filled) {
      revert ErrTakingAmountAboveRemaining();
    }
    // this is the actual taking amount and making amount from the caller
    uint256 actualMakingAmount = (takingAmount * makingAmount) / takingAmount; // round down to avoid rounding error
    uint256 minMakingAmount = (takingAmount * orderTakingAmount + orderMakingAmount - 1) / orderMakingAmount; // ceilup to avoid rounding error
    if (actualMakingAmount < minMakingAmount) revert ErrInsufficientMakingAmount();

    // fill the order
    _fillOrder(order, execution, orderMakingAmount, minMakingAmount, takingAmount);
    emit FillOrder(
      orderHash,
      order.maker,
      _msgSender(),
      order.pool,
      execution.positionId,
      takingAmount,
      minMakingAmount
    );

    // update execution status
    execution.filled = uint128(execution.filled + takingAmount);
    if (execution.filled == orderMakingAmount) {
      execution.status = OrderExecutionLibrary.Status.FullyFilled;

      // transfer created position to the maker when fill the order fully
      if (order.positionId == 0 && execution.positionId != 0) {
        IERC721(order.pool).transferFrom(address(this), order.maker, execution.positionId);
      }
    } else {
      execution.status = OrderExecutionLibrary.Status.PartialFilled;
    }
    executions[orderHash] = OrderExecutionLibrary.encode(execution);
  }

  /// @inheritdoc ILimitOrderManager
  function cancelOrder(OrderLibrary.Order memory order) external nonReentrant {
    // check only maker can cancel order
    if (order.maker != _msgSender()) revert ErrNotMaker();

    bytes32 orderHash = _hash(order);
    OrderExecutionLibrary.Execution memory execution = executions[orderHash].decode();
    if (execution.status == OrderExecutionLibrary.Status.Cancelled) revert ErrOrderAlreadyCancelled();
    if (execution.status == OrderExecutionLibrary.Status.FullyFilled) revert ErrOrderAlreadyFilled();

    // transfer created position to the maker
    if (order.positionId == 0 && execution.positionId != 0) {
      IERC721(order.pool).transferFrom(address(this), order.maker, execution.positionId);
    }

    // update execution status
    execution.status = OrderExecutionLibrary.Status.Cancelled;
    executions[orderHash] = OrderExecutionLibrary.encode(execution);

    // emit event
    emit CancelOrder(orderHash, order.maker, order.pool, execution.positionId);
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Update the address of treasury contract.
  /// @param _treasury The address of the new treasury contract.
  function updateTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateTreasury(_treasury);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to update the address of treasury contract.
  /// @param newTreasury The address of the new treasury contract.
  function _updateTreasury(address newTreasury) internal {
    address oldTreasury = treasury;
    treasury = newTreasury;

    emit UpdateTreasury(oldTreasury, newTreasury);
  }

  /// @dev Internal function to hash the order.
  /// @param order The order.
  /// @return The hash of the order.
  function _hash(OrderLibrary.Order memory order) internal view returns (bytes32) {
    // split the order into two parts to avoid stack too deep error
    bytes memory encoded1 = abi.encode(
      order.maker,
      order.pool,
      order.positionId,
      order.positionSide,
      order.orderType,
      order.orderSide,
      order.allowPartialFill
    );
    bytes memory encoded2 = abi.encode(
      order.triggerPrice,
      order.fxUSDDelta,
      order.collDelta,
      order.debtDelta,
      order.nonce,
      order.salt,
      order.deadline
    );
    return _hashTypedDataV4(keccak256(abi.encodePacked(OrderLibrary.LIMIT_ORDER_TYPEHASH, encoded1, encoded2)));
  }

  /// @dev Internal function to check the signature.
  /// @param order The order.
  /// @param orderHash The hash of the order.
  /// @param signature The signature.
  function _checkSignature(OrderLibrary.Order memory order, bytes32 orderHash, bytes memory signature) internal view {
    if ((signature.length != 65 && signature.length != 64) || ECDSA.recover(orderHash, signature) != order.maker) {
      if (order.maker.code.length > 0) {
        bytes4 result = IERC1271(order.maker).isValidSignature(orderHash, signature);
        if (result != IERC1271.isValidSignature.selector) {
          revert ErrBadSignature();
        }
      } else {
        revert ErrBadSignature();
      }
    }
  }

  /// @dev Internal function to fill the order.
  /// @param order The order struct in memory.
  /// @param execution The execution result of the order.
  /// @param orderMakingAmount The order making amount.
  /// @param makingAmount The making amount from the caller.
  /// @param takingAmount The taking amount from the caller.
  function _fillOrder(
    OrderLibrary.Order memory order,
    OrderExecutionLibrary.Execution memory execution,
    uint256 orderMakingAmount,
    uint256 makingAmount,
    uint256 takingAmount
  ) internal {
    address makingToken = order.getMakingToken();
    address takingToken = order.getTakingToken();

    // calculate the delta of the order
    int256 collDelta = (order.collDelta * int256(takingAmount)) / int256(orderMakingAmount);
    int256 debtDelta = (order.debtDelta * int256(takingAmount)) / int256(orderMakingAmount);
    int256 fxUSDDelta = (order.fxUSDDelta * int256(takingAmount)) / int256(orderMakingAmount);

    // transfer taking token from caller to this contract
    IERC20(takingToken).safeTransferFrom(_msgSender(), address(this), makingAmount);
    // transfer taking token from order.maker to this contract
    if (fxUSDDelta > 0) {
      IERC20(fxUSD).safeTransferFrom(order.maker, address(this), uint256(fxUSDDelta));
    }
    // transfer position from order.maker to this contract
    if (order.positionId != 0) {
      execution.positionId = uint32(order.positionId);
      IERC721(order.pool).transferFrom(order.maker, address(this), order.positionId);
    }

    // operate the position
    address manager = order.positionSide ? LongPoolManager : ShortPoolManager;
    if (collDelta > 0) {
      // take min with actual balance to avoid rounding error
      uint256 balance = IERC20(takingToken).balanceOf(address(this));
      if (balance < uint256(collDelta)) {
        collDelta = int256(balance);
      }
      IERC20(takingToken).forceApprove(manager, uint256(collDelta));
    }
    if (debtDelta < 0) {
      // take min with actual balance to avoid rounding error
      uint256 balance = IERC20(takingToken).balanceOf(address(this));
      if (balance < uint256(-debtDelta)) {
        debtDelta = -int256(balance);
      }
      IERC20(takingToken).forceApprove(manager, uint256(-debtDelta));
    }
    if (collDelta < 0 && debtDelta < 0) {
      // check if the position is fully closed, use fxUSD amount to check
      (uint256 rawColls, uint256 rawDebts) = IPool(order.pool).getPosition(execution.positionId);
      if (order.positionSide && uint256(-debtDelta) >= rawDebts) {
        debtDelta = type(int256).min;
        collDelta = type(int256).min;
      } else if (!order.positionSide && uint256(-collDelta) >= rawColls) {
        debtDelta = type(int256).min;
        collDelta = type(int256).min;
      }
    }
    execution.positionId = uint32(
      IPoolManager(manager).operate(order.pool, execution.positionId, collDelta, debtDelta)
    );

    // transfer all making token amounts to the caller
    _transferToken(makingToken, _msgSender(), takingAmount);
    // transfer position to the order.maker
    if (order.positionId != 0) {
      IERC721(order.pool).transferFrom(address(this), order.maker, order.positionId);
    }
    // transfer fxUSD to the order.maker, possible less than the amount due to fees
    if (fxUSDDelta < 0) {
      _transferToken(fxUSD, order.maker, uint256(-fxUSDDelta));
    }

    // sweep remaining making/taking token to the treasury
    _transferToken(makingToken, treasury, type(uint256).max);
    _transferToken(takingToken, treasury, type(uint256).max);
  }

  /// @dev Internal function to transfer token.
  /// @param token The address of token.
  /// @param receiver The address of receiver.
  /// @param amount The amount of token.
  function _transferToken(address token, address receiver, uint256 amount) internal {
    // @note It is possible that the token balance is less than the amount, since the pool manager charges fees.
    uint256 balance = IERC20(token).balanceOf(address(this));
    if (balance >= amount) {
      IERC20(token).safeTransfer(receiver, amount);
    } else {
      if (balance > 0) {
        IERC20(token).safeTransfer(receiver, balance);
      }
    }
  }
}
