// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import { IConditionalOrder } from "../../external/composable-cow/interfaces/IConditionalOrder.sol";
import { BaseConditionalOrder } from "../../external/composable-cow/BaseConditionalOrder.sol";
import { GPv2Order } from "../../external/cowprotocol/libraries/GPv2Order.sol";

import { IComposableCoW } from "../../interfaces/cowswap/IComposableCoW.sol";

import { PermissionedSwap } from "./PermissionedSwap.sol";

contract DutchAuctionReceiver {
  using SafeERC20 for IERC20;

  error NotFactory();

  /// @notice The factory of the auction.
  address public immutable factory;

  /// @notice The token of the auction.
  address public immutable quoteToken;

  constructor(address _quoteToken) {
    factory = msg.sender;
    quoteToken = _quoteToken;
  }

  function withdraw(address token, uint256 amount) external {
    if (msg.sender != factory) revert NotFactory();

    IERC20(token).safeTransfer(factory, amount);
  }
}

abstract contract DutchAuctionSwap is PermissionedSwap, BaseConditionalOrder {
  using SafeERC20 for IERC20;

  /// @notice Emitted when an auction is created.
  /// @param staticInputHash The hash of the static input.
  /// @param receiver The receiver of the auction.
  event AuctionCreated(bytes32 indexed staticInputHash, address indexed receiver);

  /**********
   * Errors *
   **********/

  /// @dev Thrown when the auction has not started yet.
  error AuctionNotStarted(uint32 startTime);

  /// @dev Thrown when the auction already exists.
  error AuctionAlreadyExists();

  /// @dev Thrown when the auction is invalid.
  error InvalidAuction();

  /***********
   * Structs *
   ***********/

  /// @dev `staticInput` data struct for dutch auctions
  struct Data {
    IERC20 sellToken;
    IERC20 buyToken;
    uint256 sellAmount;
    bytes32 appData;
    // dutch auction specifics
    uint32 startTime; // 0 = mining time, > 0 = specific start time
    uint256 startBuyAmount;
    uint32 stepDuration; // measured in seconds
    uint256 stepDiscount; // measured in BPS (1/10000)
    uint256 numSteps;
  }

  /*************
   * Constants *
   *************/

  /// @notice The role for auction creator.
  bytes32 public constant AUCTION_CREATOR_ROLE = keccak256("AUCTION_CREATOR_ROLE");

  /// @notice The role for auction collector.
  bytes32 public constant AUCTION_COLLECTOR_ROLE = keccak256("AUCTION_COLLECTOR_ROLE");

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The settlement contract.
  address public immutable settlement;

  /// @notice The composable cow contract.
  address public immutable composableCow;

  /*********************
   * Storage Variables *
   *********************/

  /// @notice Mapping from the static input hash to the receiver of the auction.
  mapping(bytes32 => address) public auctionReceiver;

  /// @notice Mapping from the static input hash to the canceled status of the auction.
  mapping(bytes32 => bool) public isAuctionCanceled;

  /// @dev reserved slots.
  uint256[48] private __gap;

  /***************
   * Constructor *
   ***************/

  constructor(address _settlement, address _composableCow) {
    settlement = _settlement;
    composableCow = _composableCow;
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc IERC165
  function supportsInterface(
    bytes4 interfaceId
  ) public view override(AccessControlUpgradeable, BaseConditionalOrder) returns (bool) {
    return
      AccessControlUpgradeable.supportsInterface(interfaceId) || BaseConditionalOrder.supportsInterface(interfaceId);
  }

  /// @inheritdoc BaseConditionalOrder
  function getTradeableOrder(
    address,
    address,
    bytes32,
    bytes calldata staticInput,
    bytes calldata
  ) public view override returns (GPv2Order.Data memory order) {
    address receiver = auctionReceiver[keccak256(staticInput)];
    if (receiver == address(0)) revert InvalidAuction();

    // check if the auction is canceled
    if (isAuctionCanceled[keccak256(staticInput)]) {
        revert PollNever("auction canceled");
    }

    Data memory data = abi.decode(staticInput, (Data));

    // woah there! you're too early and the auction hasn't started. Come back later.
    if (data.startTime > uint32(block.timestamp)) {
      revert PollTryAtEpoch(data.startTime, "auction not started");
    }

    // bucket is the current step of the auction, use unchecked here to save gas
    uint32 bucket;
    unchecked {
      bucket = uint32(block.timestamp - data.startTime) / data.stepDuration;
    }

    // if too late, not valid, revert
    if (bucket >= data.numSteps) {
      revert PollNever("auction ended");
    }

    // calculate the current buy amount
    // Note: due to integer rounding, the current buy amount might be slightly lower than expected (off-by-one)
    uint256 bucketBuyAmount = data.startBuyAmount - (bucket * data.stepDiscount * data.startBuyAmount) / 10000;

    // generate the order
    order = GPv2Order.Data(
      data.sellToken,
      data.buyToken,
      receiver,
      data.sellAmount,
      bucketBuyAmount,
      data.startTime + (bucket + 1) * data.stepDuration, // valid until the end of the current bucket
      data.appData,
      0, // use zero fee for limit orders
      GPv2Order.KIND_SELL, // only sell order support for now
      false, // partially fillable orders are not supported
      GPv2Order.BALANCE_ERC20,
      GPv2Order.BALANCE_ERC20
    );

    // check if the auction is filled
    if (data.buyToken.balanceOf(receiver) >= bucketBuyAmount) {
      revert PollNever("auction filled");
    }
  }

  /// @notice Validate the data for the auction.
  /// @param data The data for the auction.
  function validateData(bytes memory data) external pure {
    _validateData(abi.decode(data, (Data)));
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Create a new auction.
  /// @param data The data for the auction.
  /// @param salt The salt for the auction.
  function createAuction(Data memory data, bytes32 salt) external onlyRole(AUCTION_CREATOR_ROLE) {
    DutchAuctionReceiver receiver = new DutchAuctionReceiver(address(data.buyToken));

    _createAuction(data, address(receiver), salt);
  }

  /// @notice Create multiple auctions with same buy token.
  /// @param data The data for the auctions.
  /// @param salts The salts for the auctions.
  function createAuctions(Data[] memory data, bytes32[] memory salts) external onlyRole(AUCTION_CREATOR_ROLE) {
    DutchAuctionReceiver receiver = new DutchAuctionReceiver(address(data[0].buyToken));
    for (uint256 i = 0; i < data.length; i++) {
      if (i > 0 && data[i].buyToken != data[i - 1].buyToken) {
        revert InvalidAuction();
      }

      _createAuction(data[i], address(receiver), salts[i]);
    }
  }

  /// @notice Cancel the auction.
  /// @param staticInputHash The hash of the static input.
  function cancelAuction(bytes32 staticInputHash) external onlyRole(AUCTION_CREATOR_ROLE) {
    isAuctionCanceled[staticInputHash] = true;
  }

  /// @notice Collect the auctions.
  /// @param receivers The receivers of the auctions.
  function collectAuctions(
    address[] memory receivers,
    address[] memory tokens
  ) external onlyRole(AUCTION_COLLECTOR_ROLE) {
    for (uint256 i = 0; i < receivers.length; i++) {
      DutchAuctionReceiver(receivers[i]).withdraw(tokens[i], IERC20(tokens[i]).balanceOf(receivers[i]));
    }
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal method for creating an auction.
  /// @param data The data for the auction.
  /// @param receiver The receiver of the auction.
  /// @param salt The salt for the auction.
  function _createAuction(Data memory data, address receiver, bytes32 salt) internal {
    _validateData(data);

    bytes memory staticInput = abi.encode(data);
    bytes32 staticInputHash = keccak256(staticInput);
    if (auctionReceiver[staticInputHash] != address(0)) revert AuctionAlreadyExists();
    auctionReceiver[staticInputHash] = receiver;

    IConditionalOrder.ConditionalOrderParams memory params = IConditionalOrder.ConditionalOrderParams({
      handler: this,
      salt: salt,
      staticInput: staticInput
    });
    IComposableCoW(composableCow).create(params, true);

    // approve sell token to cowswap
    data.sellToken.forceApprove(settlement, data.sellAmount);

    emit AuctionCreated(staticInputHash, address(receiver));
  }

  /// @dev Internal method for validating the ABI encoded data struct.
  /// @param data The data for the auction.
  function _validateData(Data memory data) internal pure {
    if (data.sellToken == data.buyToken) revert OrderNotValid("same tokens");
    if (data.sellAmount == 0) revert OrderNotValid("min sell amount");
    if (data.stepDuration == 0) revert OrderNotValid("min auction duration");
    if (data.stepDiscount == 0) revert OrderNotValid("min step discount");
    if (data.stepDiscount >= 10000) revert OrderNotValid("max step discount");
    if (data.numSteps <= 1) revert OrderNotValid("min num steps");
    if (data.numSteps * data.stepDiscount >= 10000) revert OrderNotValid("max total discount");
  }
}
