// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { WordCodec } from "../common/codec/WordCodec.sol";

library OrderExecutionLibrary {
  using WordCodec for bytes32;

  /*************
   * Constants *
   *************/

  /// @dev The offset of the Execution.status.
  uint256 private constant EXECUTION_STATUS_OFFSET = 0;
  /// @dev The length of the Execution.status.
  uint256 private constant EXECUTION_STATUS_BITS = 8;
  /// @dev The offset of the Execution.filled.
  uint256 private constant EXECUTION_FILLED_OFFSET = 8;
  /// @dev The length of the Execution.filled.
  uint256 private constant EXECUTION_FILLED_BITS = 128;
  /// @dev The offset of the Execution.positionId.
  uint256 private constant EXECUTION_POSITION_ID_OFFSET = 136;
  /// @dev The length of the Execution.positionId.
  uint256 private constant EXECUTION_POSITION_ID_BITS = 32;

  /*********
   * Enums *
   *********/

  enum Status {
    New,
    PartialFilled,
    FullyFilled,
    Cancelled
  }

  /***********
   * Structs *
   ***********/

  /// @dev The execution struct.
  /// @param status The status of the execution.
  /// @param filled The filled amount.
  /// @param positionId The id of the position.
  struct Execution {
    Status status;
    uint128 filled;
    uint32 positionId;
  }

  /***************************
   * Internal View Functions *
   ***************************/

  /// @dev Encode the execution struct into a bytes32.
  /// @param execution The execution struct.
  /// @return The encoded bytes32.
  function encode(Execution memory execution) internal pure returns (bytes32) {
    bytes32 data = 0;
    data = WordCodec.insertUint(data, uint256(execution.status), EXECUTION_STATUS_OFFSET, EXECUTION_STATUS_BITS);
    data = WordCodec.insertUint(data, execution.filled, EXECUTION_FILLED_OFFSET, EXECUTION_FILLED_BITS);
    data = WordCodec.insertUint(data, execution.positionId, EXECUTION_POSITION_ID_OFFSET, EXECUTION_POSITION_ID_BITS);
    return data;
  }

  /// @dev Decode the bytes32 into the execution struct.
  /// @param value The bytes32.
  /// @return The execution struct.
  function decode(bytes32 value) internal pure returns (Execution memory) {
    return Execution({ status: getStatus(value), filled: getFilled(value), positionId: getPositionId(value) });
  }

  /// @dev Get the status of the execution.
  /// @param value The bytes32.
  /// @return The status.
  function getStatus(bytes32 value) internal pure returns (Status) {
    return Status(value.decodeUint(EXECUTION_STATUS_OFFSET, EXECUTION_STATUS_BITS));
  }

  /// @dev Get the filled amount of the execution.
  /// @param value The bytes32.
  /// @return The filled amount.
  function getFilled(bytes32 value) internal pure returns (uint128) {
    return uint128(value.decodeUint(EXECUTION_FILLED_OFFSET, EXECUTION_FILLED_BITS));
  }

  /// @dev Get the position id of the execution.
  /// @param value The bytes32.
  /// @return The position id.
  function getPositionId(bytes32 value) internal pure returns (uint32) {
    return uint32(value.decodeUint(EXECUTION_POSITION_ID_OFFSET, EXECUTION_POSITION_ID_BITS));
  }
}
