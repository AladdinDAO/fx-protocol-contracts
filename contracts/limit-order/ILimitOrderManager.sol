// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { OrderLibrary } from "./OrderLibrary.sol";
import { OrderExecutionLibrary } from "./OrderExecutionLibrary.sol";

interface ILimitOrderManager {
  /**********
   * Events *
   **********/

  /// @notice Emitted when nonce is advanced.
  /// @param maker The maker of the order.
  /// @param nonce The nonce.
  event AdvanceNonce(address indexed maker, uint256 nonce);

  /// @notice Emitted when order is cancelled.
  /// @param orderHash The hash of the order.
  /// @param maker The maker of the order.
  event CancelOrder(bytes32 indexed orderHash, address indexed maker, address pool, uint256 positionId);

  /// @notice Emitted when order is filled.
  /// @param orderHash The hash of the order.
  /// @param taker The taker of the order.
  /// @param makingAmount The making amount.
  /// @param takingAmount The taking amount.
  event FillOrder(bytes32 indexed orderHash, address indexed maker, address indexed taker, address pool, uint256 positionId, uint256 makingAmount, uint256 takingAmount);

  /// @notice Emitted when the address of treasury contract is updated.
  /// @param oldTreasury The address of the old treasury contract.
  /// @param newTreasury The address of the new treasury contract.
  event UpdateTreasury(address indexed oldTreasury, address indexed newTreasury);

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Get the hash of the order.
  /// @param order The order struct.
  /// @return The hash of the order.
  function getOrderHash(OrderLibrary.Order memory order) external view returns (bytes32);

  /// @notice Get the details of the order.
  /// @param order The order struct.
  /// @return makingToken The making token.
  /// @return takingToken The taking token.
  /// @return makingAmount The making amount.
  /// @return takingAmount The taking amount.
  function getOrderDetails(
    OrderLibrary.Order memory order
  ) external view returns (address makingToken, address takingToken, uint256 makingAmount, uint256 takingAmount);

  /// @notice Get the execution of the order.
  /// @param orderHash The hash of the order.
  /// @return The execution of the order.
  function getExecution(bytes32 orderHash) external view returns (OrderExecutionLibrary.Execution memory);

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Increase the nonce of the maker.
  /// @dev Use this to increase the nonce of the maker.
  function increaseNonce() external;

  /// @notice Fill the order.
  /// @param order The order struct.
  /// @param signature The signature of the order.
  /// @param makingAmount The making amount from the caller.
  /// @param takingAmount The taking amount from the caller.
  function fillOrder(
    OrderLibrary.Order memory order,
    bytes memory signature,
    uint256 makingAmount,
    uint256 takingAmount
  ) external;

  /// @notice Cancel the order.
  /// @param order The order struct.
  function cancelOrder(OrderLibrary.Order memory order) external;
}
