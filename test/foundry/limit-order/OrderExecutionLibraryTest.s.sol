// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { Test } from "forge-std/Test.sol";
import { OrderExecutionLibrary } from "contracts/limit-order/OrderExecutionLibrary.sol";

contract OrderExecutionLibraryHarness {
	using OrderExecutionLibrary for bytes32;

	function encode(OrderExecutionLibrary.Execution memory execution) external pure returns (bytes32) {
		return OrderExecutionLibrary.encode(execution);
	}

	function decode(bytes32 value) external pure returns (OrderExecutionLibrary.Execution memory) {
		return OrderExecutionLibrary.decode(value);
	}

	function getStatus(bytes32 value) external pure returns (OrderExecutionLibrary.Status) {
		return OrderExecutionLibrary.getStatus(value);
	}

	function getFilled(bytes32 value) external pure returns (uint128) {
		return OrderExecutionLibrary.getFilled(value);
	}

	function getPositionId(bytes32 value) external pure returns (uint32) {
		return OrderExecutionLibrary.getPositionId(value);
	}
}

contract OrderExecutionLibraryTest is Test {
	OrderExecutionLibraryHarness internal harness;

	function setUp() public {
		harness = new OrderExecutionLibraryHarness();
	}

	function toStatus(uint8 raw) private pure returns (OrderExecutionLibrary.Status) {
		return OrderExecutionLibrary.Status(raw % 4);
	}

	function test_encode_decode_roundtrip(
		uint8 rawStatus,
		uint128 filled,
		uint32 positionId
	) public view {
		OrderExecutionLibrary.Status status = toStatus(rawStatus);
		OrderExecutionLibrary.Execution memory exec = OrderExecutionLibrary.Execution({
			status: status,
			filled: filled,
			positionId: positionId
		});

		bytes32 encoded = harness.encode(exec);
		OrderExecutionLibrary.Execution memory decoded = harness.decode(encoded);

		assertEq(uint256(uint8(decoded.status)), uint256(uint8(status)), "status mismatch");
		assertEq(decoded.filled, filled, "filled mismatch");
		assertEq(decoded.positionId, positionId, "positionId mismatch");
	}

	function test_getters_match_fields(
		uint8 rawStatus,
		uint128 filled,
		uint32 positionId
	) public view {
		OrderExecutionLibrary.Status status = toStatus(rawStatus);
		OrderExecutionLibrary.Execution memory exec = OrderExecutionLibrary.Execution({
			status: status,
			filled: filled,
			positionId: positionId
		});

		bytes32 encoded = harness.encode(exec);

		assertEq(uint256(uint8(harness.getStatus(encoded))), uint256(uint8(status)), "status getter");
		assertEq(harness.getFilled(encoded), filled, "filled getter");
		assertEq(harness.getPositionId(encoded), positionId, "positionId getter");
	}

	function test_zero_values() public view {
		OrderExecutionLibrary.Execution memory exec = OrderExecutionLibrary.Execution({
			status: OrderExecutionLibrary.Status.New,
			filled: 0,
			positionId: 0
		});
		bytes32 encoded = harness.encode(exec);
		OrderExecutionLibrary.Execution memory decoded = harness.decode(encoded);
		assertEq(uint256(uint8(decoded.status)), uint256(uint8(OrderExecutionLibrary.Status.New)));
		assertEq(decoded.filled, 0);
		assertEq(decoded.positionId, 0);
	}

	function test_max_values() public view {
		OrderExecutionLibrary.Execution memory exec = OrderExecutionLibrary.Execution({
			status: OrderExecutionLibrary.Status.Cancelled,
			filled: type(uint128).max,
			positionId: type(uint32).max
		});
		bytes32 encoded = harness.encode(exec);
		OrderExecutionLibrary.Execution memory decoded = harness.decode(encoded);
		assertEq(uint256(uint8(decoded.status)), uint256(uint8(OrderExecutionLibrary.Status.Cancelled)));
		assertEq(decoded.filled, type(uint128).max);
		assertEq(decoded.positionId, type(uint32).max);
	}

	function test_field_isolation_status_change(uint128 filled, uint32 positionId) public view {
		OrderExecutionLibrary.Execution memory a = OrderExecutionLibrary.Execution({
			status: OrderExecutionLibrary.Status.New,
			filled: filled,
			positionId: positionId
		});
		OrderExecutionLibrary.Execution memory b = OrderExecutionLibrary.Execution({
			status: OrderExecutionLibrary.Status.FullyFilled,
			filled: filled,
			positionId: positionId
		});
		bytes32 ea = harness.encode(a);
		bytes32 eb = harness.encode(b);
		assertEq(harness.getFilled(ea), harness.getFilled(eb), "filled changed");
		assertEq(harness.getPositionId(ea), harness.getPositionId(eb), "positionId changed");
	}

	function test_field_isolation_filled_change(uint8 rawStatus, uint32 positionId) public view {
		OrderExecutionLibrary.Status status = toStatus(rawStatus);
		OrderExecutionLibrary.Execution memory a = OrderExecutionLibrary.Execution({
			status: status,
			filled: 0,
			positionId: positionId
		});
		OrderExecutionLibrary.Execution memory b = OrderExecutionLibrary.Execution({
			status: status,
			filled: type(uint128).max,
			positionId: positionId
		});
		bytes32 ea = harness.encode(a);
		bytes32 eb = harness.encode(b);
		assertEq(uint256(uint8(harness.getStatus(ea))), uint256(uint8(harness.getStatus(eb))), "status changed");
		assertEq(harness.getPositionId(ea), harness.getPositionId(eb), "positionId changed");
	}

	function test_field_isolation_position_change(uint8 rawStatus, uint128 filled) public view {
		OrderExecutionLibrary.Status status = toStatus(rawStatus);
		OrderExecutionLibrary.Execution memory a = OrderExecutionLibrary.Execution({
			status: status,
			filled: filled,
			positionId: 0
		});
		OrderExecutionLibrary.Execution memory b = OrderExecutionLibrary.Execution({
			status: status,
			filled: filled,
			positionId: type(uint32).max
		});
		bytes32 ea = harness.encode(a);
		bytes32 eb = harness.encode(b);
		assertEq(uint256(uint8(harness.getStatus(ea))), uint256(uint8(harness.getStatus(eb))), "status changed");
		assertEq(harness.getFilled(ea), harness.getFilled(eb), "filled changed");
	}
}