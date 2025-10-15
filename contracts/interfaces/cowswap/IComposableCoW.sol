// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IConditionalOrder } from "../../external/composable-cow/interfaces/IConditionalOrder.sol";
import { GPv2Order } from "../../external/cowprotocol/libraries/GPv2Order.sol";

interface IComposableCoW {
  // A struct to encapsulate order parameters / offchain input
  struct PayloadStruct {
    bytes32[] proof;
    IConditionalOrder.ConditionalOrderParams params;
    bytes offchainInput;
  }

  // A struct representing where to find the proofs
  struct Proof {
    uint256 location;
    bytes data;
  }

  // @dev Mapping of owner's on-chain storage slots
  function cabinet(address owner, bytes32 ctx) external view returns (bytes32);

  /**
   * Set the merkle root of the user's conditional orders
   * @notice Set the merkle root of the user's conditional orders
   * @param root The merkle root of the user's conditional orders
   * @param proof Where to find the proofs
   */
  function setRoot(bytes32 root, Proof calldata proof) external;

  /**
   * Set the merkle root of the user's conditional orders and store a value from on-chain in the cabinet
   * @param root The merkle root of the user's conditional orders
   * @param proof Where to find the proofs
   * @param factory A factory from which to get a value to store in the cabinet related to the merkle root
   * @param data Implementation specific off-chain data
   */
  function setRootWithContext(bytes32 root, Proof calldata proof, address factory, bytes calldata data) external;

  /**
   * Authorise a single conditional order
   * @param params The parameters of the conditional order
   * @param dispatch Whether to dispatch the `ConditionalOrderCreated` event
   */
  function create(IConditionalOrder.ConditionalOrderParams calldata params, bool dispatch) external;

  /**
   * Authorise a single conditional order and store a value from on-chain in the cabinet
   * @param params The parameters of the conditional order
   * @param factory A factory from which to get a value to store in the cabinet
   * @param data Implementation specific off-chain data
   * @param dispatch Whether to dispatch the `ConditionalOrderCreated` event
   */
  function createWithContext(
    IConditionalOrder.ConditionalOrderParams calldata params,
    address factory,
    bytes calldata data,
    bool dispatch
  ) external;

  /**
   * Remove the authorisation of a single conditional order
   * @param singleOrderHash The hash of the single conditional order to remove
   */
  function remove(bytes32 singleOrderHash) external;

  /**
   * Set the swap guard of the user's conditional orders
   * @param swapGuard The address of the swap guard
   */
  function setSwapGuard(address swapGuard) external;

  /**
   * @dev This function does not make use of the `typeHash` parameter as CoW Protocol does not
   *      have more than one type.
   * @param encodeData Is the abi encoded `GPv2Order.Data`
   * @param payload Is the abi encoded `PayloadStruct`
   */
  function isValidSafeSignature(
    address safe,
    address sender,
    bytes32 _hash,
    bytes32 _domainSeparator,
    bytes32, // typeHash
    bytes calldata encodeData,
    bytes calldata payload
  ) external view returns (bytes4 magic);

  /**
   * Get the `GPv2Order.Data` and signature for submitting to CoW Protocol API
   * @param owner of the order
   * @param params `ConditionalOrderParams` for the order
   * @param offchainInput any dynamic off-chain input for generating the discrete order
   * @param proof if using merkle-roots that H(handler || salt || staticInput) is in the merkle tree
   * @return order discrete order for submitting to CoW Protocol API
   * @return signature for submitting to CoW Protocol API
   */
  function getTradeableOrderWithSignature(
    address owner,
    IConditionalOrder.ConditionalOrderParams calldata params,
    bytes calldata offchainInput,
    bytes32[] calldata proof
  ) external view returns (GPv2Order.Data memory order, bytes memory signature);

  /**
   * Return the hash of the conditional order parameters
   * @param params `ConditionalOrderParams` for the order
   * @return hash of the conditional order parameters
   */
  function hash(IConditionalOrder.ConditionalOrderParams memory params) external pure returns (bytes32);
}
