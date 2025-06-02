// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { IPool } from "../interfaces/IPool.sol";

interface IPositionOperateFlashLoanFacet {
  struct ConvertInParams {
    address tokenIn;
    uint256 amount;
    address target;
    bytes data;
    uint256 minOut;
    bytes signature;
  }

  function openOrAddPositionFlashLoanV2(
    ConvertInParams memory params,
    address pool,
    uint256 positionId,
    uint256 borrowAmount,
    bytes calldata data
  ) external payable;
}

/// @dev This is a modified version of `MultiMerkleStash` from Stake DAO.
/// The source code is at https://etherscan.io/address/0x03E34b085C52985F6a5D27243F20C84bDdc01Db4.
contract PositionAirdrop is Ownable {
  using SafeERC20 for IERC20;

  address private constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

  address private constant DIAMOND = 0x33636D49FbefBE798e15e7F356E8DBef543CC708;

  /**********
   * Events *
   **********/

  event Claimed(address indexed account, uint256 index, uint256 amount);
  event MerkleRootUpdated(bytes32 indexed merkleRoot);

  /**********
   * Errors *
   **********/

  error ErrorNoClaim();

  error ErrorAlreadyClaimed();

  error ErrorInvalidProof();

  /*************
   * Variables *
   *************/

  /// @notice The merkle root.
  bytes32 public root;

  /// @notice Mapping from user address to claim status.
  mapping(address => bool) public claimed;

  /***************
   * Constructor *
   ***************/

  constructor(address _owner) Ownable(_owner) {}

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Claim position
  /// @param index The index of the claim.
  /// @param amount The amount of the claim.
  /// @param merkleProof The merkle proof of the claim.
  /// @param params The parameters of the claim.
  /// @param pool The pool address.
  /// @param borrowAmount The borrow amount of the claim.
  /// @param hookData The hook data of the claim.
  function claim(
    uint256 index,
    uint256 amount,
    bytes32[] calldata merkleProof,
    IPositionOperateFlashLoanFacet.ConvertInParams memory params,
    address pool,
    uint256 borrowAmount,
    bytes calldata hookData
  ) external {
    address account = _msgSender();
    if (root == bytes32(0)) revert ErrorNoClaim();
    if (claimed[account]) revert ErrorAlreadyClaimed();

    // Verify the merkle proof.
    bytes32 node = keccak256(abi.encode(index, account, amount));
    if (!MerkleProof.verify(merkleProof, root, node)) revert ErrorInvalidProof();

    // Update claim status
    claimed[account] = true;

    // Open position with flashlaon
    uint256 position = IPool(pool).getNextPositionId();
    IERC20(USDC).forceApprove(DIAMOND, amount);
    IPositionOperateFlashLoanFacet(DIAMOND).openOrAddPositionFlashLoanV2(params, pool, 0, borrowAmount, hookData);
    IERC721(pool).transferFrom(address(this), account, position);

    emit Claimed(account, index, amount);
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Update the merkle root.
  /// @param merkleRoot The new merkle root.
  function updateMerkleRoot(bytes32 merkleRoot) external onlyOwner {
    root = merkleRoot;

    emit MerkleRootUpdated(merkleRoot);
  }

  /// @notice Withdraw tokens.
  /// @param token The token to withdraw.
  /// @param receiver The address of token recipient.
  function withdraw(address token, address receiver) external onlyOwner {
    uint256 balance = IERC20(token).balanceOf(address(this));
    IERC20(token).safeTransfer(receiver, balance);
  }

  /**********************
   * Internal Functions *
   **********************/
}
