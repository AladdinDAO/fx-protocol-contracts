// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { IMultiPathConverter } from "../../helpers/interfaces/IMultiPathConverter.sol";
import { IBalancerVault } from "../../interfaces/Balancer/IBalancerVault.sol";
import { IPoolManager } from "../../interfaces/IPoolManager.sol";
import { IPool } from "../../interfaces/IPool.sol";

import { WordCodec } from "../../common/codec/WordCodec.sol";
import { LibRouter } from "../libraries/LibRouter.sol";

contract PositionOperateFlashLoanFacet {
  using SafeERC20 for IERC20;
  using WordCodec for bytes32;

  /**********
   * Errors *
   **********/

  /// @dev Thrown when the caller is not self.
  error ErrorNotFromSelf();

  /// @dev Thrown when the amount of tokens swapped are not enough.
  error ErrorInsufficientAmountSwapped();

  /// @dev Thrown when debt ratio out of range.
  error ErrorDebtRatioOutOfRange();

  /*************
   * Constants *
   *************/

  address private constant fxUSD = 0x085780639CC2cACd35E474e71f4d000e2405d8f6;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @dev The address of Balancer V2 Vault.
  address private immutable balancer;

  /// @dev The address of `PoolManager` contract.
  address private immutable poolManager;

  /// @dev The address of `MultiPathConverter` contract.
  address private immutable converter;

  /*************
   * Modifiers *
   *************/

  modifier onlySelf() {
    if (msg.sender != address(this)) revert ErrorNotFromSelf();
    _;
  }

  modifier onFlashLoan() {
    LibRouter.RouterStorage storage $ = LibRouter.routerStorage();
    $.flashLoanContext = LibRouter.HAS_FLASH_LOAN;
    _;
    $.flashLoanContext = LibRouter.NOT_FLASH_LOAN;
  }

  /***************
   * Constructor *
   ***************/

  constructor(address _balancer, address _poolManager, address _converter) {
    balancer = _balancer;
    poolManager = _poolManager;
    converter = _converter;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Open a new position or add collateral to position with any tokens.
  /// @param params The parameters to convert source token to collateral token.
  /// @param pool The address of fx position pool.
  /// @param positionId The index of position.
  /// @param borrowAmount The amount of collateral token to borrow.
  /// @param data Hook data passing to `onOpenOrAddPositionFlashLoan`.
  function openOrAddPositionFlashLoan(
    LibRouter.ConvertInParams memory params,
    address pool,
    uint256 positionId,
    uint256 borrowAmount,
    bytes calldata data
  ) external onFlashLoan {
    uint256 amountIn = LibRouter.transferInAndConvert(params, IPool(pool).collateralToken()) + borrowAmount;

    address[] memory tokens = new address[](1);
    uint256[] memory amounts = new uint256[](1);
    tokens[0] = IPool(pool).collateralToken();
    amounts[0] = borrowAmount;
    IBalancerVault(balancer).flashLoan(
      address(this),
      tokens,
      amounts,
      abi.encodeCall(
        PositionOperateFlashLoanFacet.onOpenOrAddPositionFlashLoan,
        (pool, positionId, amountIn, borrowAmount, msg.sender, data)
      )
    );

    // refund collateral token to caller
    LibRouter.refundERC20(IPool(pool).collateralToken(), msg.sender);
  }

  /// @notice Close a position or remove collateral from position.
  /// @param params The parameters to convert collateral token to target token.
  /// @param pool The address of fx position pool.
  /// @param borrowAmount The amount of collateral token to borrow.
  /// @param data Hook data passing to `onCloseOrRemovePositionFlashLoan`.
  function closeOrRemovePositionFlashLoan(
    LibRouter.ConvertOutParams memory params,
    address pool,
    uint256 positionId,
    uint256 amountOut,
    uint256 borrowAmount,
    bytes calldata data
  ) external onFlashLoan {
    address collateralToken = IPool(pool).collateralToken();

    address[] memory tokens = new address[](1);
    uint256[] memory amounts = new uint256[](1);
    tokens[0] = collateralToken;
    amounts[0] = borrowAmount;
    IBalancerVault(balancer).flashLoan(
      address(this),
      tokens,
      amounts,
      abi.encodeCall(
        PositionOperateFlashLoanFacet.onCloseOrRemovePositionFlashLoan,
        (pool, positionId, amountOut, borrowAmount, msg.sender, data)
      )
    );

    // convert collateral token to other token
    amountOut = IERC20(collateralToken).balanceOf(address(this));
    LibRouter.convertAndTransferOut(params, collateralToken, amountOut, msg.sender);

    // refund rest fxUSD and leveraged token
    LibRouter.refundERC20(fxUSD, msg.sender);
  }

  /// @notice Hook for `openOrAddPositionFlashLoan`.
  /// @param pool The address of fx position pool.
  /// @param position The index of position.
  /// @param amount The amount of collateral token to supply.
  /// @param repayAmount The amount of collateral token to repay.
  /// @param recipient The address of position holder.
  /// @param data Hook data passing to `onOpenOrAddPositionFlashLoan`.
  function onOpenOrAddPositionFlashLoan(
    address pool,
    uint256 position,
    uint256 amount,
    uint256 repayAmount,
    address recipient,
    bytes memory data
  ) external onlySelf {
    (bytes32 miscData, uint256 fxUSDAmount, uint256 swapEncoding, uint256[] memory swapRoutes) = abi.decode(
      data,
      (bytes32, uint256, uint256, uint256[])
    );

    // open or add collateral to position
    if (position != 0) {
      IERC721(pool).transferFrom(recipient, address(this), position);
    }
    LibRouter.approve(IPool(pool).collateralToken(), poolManager, amount);
    position = IPoolManager(poolManager).operate(pool, position, int256(amount), int256(fxUSDAmount));
    _checkPositionDebtRatio(pool, position, miscData);
    IERC721(pool).transferFrom(address(this), recipient, position);

    // swap fxUSD to collateral token
    _swap(fxUSD, fxUSDAmount, repayAmount, swapEncoding, swapRoutes);
  }

  /// @notice Hook for `closeOrRemovePositionFlashLoan`.
  /// @param pool The address of fx position pool.
  /// @param position The index of position.
  /// @param amount The amount of collateral token to withdraw.
  /// @param repayAmount The amount of collateral token to repay.
  /// @param recipient The address of position holder.
  /// @param data Hook data passing to `onOpenOrAddPositionFlashLoan`.
  function onCloseOrRemovePositionFlashLoan(
    address pool,
    uint256 position,
    uint256 amount,
    uint256 repayAmount,
    address recipient,
    bytes memory data
  ) external onlySelf {
    (bytes32 miscData, uint256 fxUSDAmount, uint256 swapEncoding, uint256[] memory swapRoutes) = abi.decode(
      data,
      (bytes32, uint256, uint256, uint256[])
    );

    // swap collateral token to fxUSD
    _swap(IPool(pool).collateralToken(), repayAmount, fxUSDAmount, swapEncoding, swapRoutes);

    // close or remove collateral from position
    IERC721(pool).transferFrom(recipient, address(this), position);
    (, uint256 maxFxUSD) = IPool(pool).getPosition(position);
    if (fxUSDAmount >= maxFxUSD) {
      // close entire position
      IPoolManager(poolManager).operate(pool, position, -int256(amount), type(int256).min);
    } else {
      IPoolManager(poolManager).operate(pool, position, -int256(amount), -int256(fxUSDAmount));
    }
    _checkPositionDebtRatio(pool, position, miscData);
    IERC721(pool).transferFrom(address(this), recipient, position);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to do swap.
  /// @param token The address of input token.
  /// @param amountIn The amount of input token.
  /// @param minOut The minimum amount of output tokens should receive.
  /// @param encoding The encoding for swap routes.
  /// @param routes The swap routes to `MultiPathConverter`.
  /// @return amountOut The amount of output tokens received.
  function _swap(
    address token,
    uint256 amountIn,
    uint256 minOut,
    uint256 encoding,
    uint256[] memory routes
  ) internal returns (uint256 amountOut) {
    LibRouter.approve(token, converter, amountIn);
    amountOut = IMultiPathConverter(converter).convert(token, amountIn, encoding, routes);
    if (amountOut < minOut) revert ErrorInsufficientAmountSwapped();
  }

  /// @dev Internal function to check debt ratio for the position.
  /// @param pool The address of fx position pool.
  /// @param positionId The index of the position.
  /// @param miscData The encoded data for debt ratio range.
  function _checkPositionDebtRatio(address pool, uint256 positionId, bytes32 miscData) internal view {
    uint256 debtRatio = IPool(pool).getPositionDebtRatio(positionId);
    uint256 minDebtRatio = miscData.decodeUint(0, 60);
    uint256 maxDebtRatio = miscData.decodeUint(60, 60);
    if (debtRatio < minDebtRatio || debtRatio > maxDebtRatio) {
      revert ErrorDebtRatioOutOfRange();
    }
  }
}
