// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { IMultiPathConverter } from "../../helpers/interfaces/IMultiPathConverter.sol";
import { ILongPoolManager } from "../../interfaces/ILongPoolManager.sol";
import { IPool } from "../../interfaces/IPool.sol";
import { IShortPool } from "../../interfaces/IShortPool.sol";
import { IShortPoolManager } from "../../interfaces/IShortPoolManager.sol";
import { IPositionOperateFacet } from "./IPositionOperateFacet.sol";

import { WordCodec } from "../../common/codec/WordCodec.sol";
import { LibRouter } from "../libraries/LibRouter.sol";
import { MorphoFlashLoanFacetBase } from "./MorphoFlashLoanFacetBase.sol";

/// @dev This facet and `PositionOperateFlashLoanFacetV2` cannot be used together.
/// It is only used for emergency close when users get credit not during position closing.
contract LongPositionEmergencyCloseFacet is MorphoFlashLoanFacetBase, IPositionOperateFacet {
  using EnumerableSet for EnumerableSet.AddressSet;
  using SafeERC20 for IERC20;
  using WordCodec for bytes32;

  /**********
   * Errors *
   **********/

  /// @dev Thrown when the amount of tokens swapped are not enough.
  error ErrorInsufficientAmountSwapped();

  /// @dev Thrown when debt ratio out of range.
  error ErrorDebtRatioOutOfRange();

  /*************
   * Constants *
   *************/

  address private constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

  address private constant fxUSD = 0x085780639CC2cACd35E474e71f4d000e2405d8f6;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @dev The address of `PoolManager` contract.
  address private immutable poolManager;

  /// @dev The address of `ShortPoolManager` contract.
  address private immutable shortPoolManager;

  /// @dev The address of `MultiPathConverter` contract.
  address private immutable converter;

  /***************
   * Constructor *
   ***************/

  constructor(
    address _morpho,
    address _poolManager,
    address _shortPoolManager,
    address _converter,
    address _whitelist
  ) MorphoFlashLoanFacetBase(_morpho, _whitelist) {
    poolManager = _poolManager;
    shortPoolManager = _shortPoolManager;
    converter = _converter;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Close a position or remove collateral from position.
  /// @param params The parameters to convert collateral token to target token.
  /// @param positionId The index of position.
  /// @param pool The address of fx position pool.
  /// @param borrowAmount The amount of collateral token to borrow.
  /// @param data Hook data passing to `onCloseOrRemovePositionFlashLoan`.
  function closeOrRemoveLongPositionFlashLoan(
    LibRouter.ConvertOutParams memory params,
    address pool,
    uint256 positionId,
    uint256 amountOut,
    uint256 borrowAmount,
    bytes calldata data
  ) external nonReentrant onlyTopLevelCall {
    address collateralToken = IPool(pool).collateralToken();

    _invokeFlashLoan(
      collateralToken,
      borrowAmount,
      abi.encodeCall(
        LongPositionEmergencyCloseFacet.onCloseOrRemoveLongPositionFlashLoan,
        (pool, positionId, amountOut, borrowAmount, msg.sender, data)
      )
    );

    // convert collateral token to other token
    amountOut = IERC20(collateralToken).balanceOf(address(this));
    LibRouter.convertAndTransferOut(params, collateralToken, amountOut, msg.sender);

    // transfer extra fxUSD to revenue pool
    LibRouter.refundERC20(fxUSD, LibRouter.routerStorage().revenuePool);
  }

  /// @notice Close a position or remove collateral from position with USDC.
  /// @param params The parameters to convert collateral token to target token.
  /// @param positionId The index of position.
  /// @param pool The address of fx position pool.
  /// @param borrowAmount The amount of collateral token to borrow.
  /// @param data Hook data passing to `onCloseOrRemovePositionFlashLoan`.
  function closeOrRemoveLongPositionFlashLoanWithUSDC(
    LibRouter.ConvertOutParams memory params,
    address pool,
    uint256 positionId,
    uint256 amountOut,
    uint256 borrowAmount,
    bytes calldata data
  ) external nonReentrant onlyTopLevelCall {
    address collateralToken = IPool(pool).collateralToken();

    _invokeFlashLoan(
      collateralToken,
      borrowAmount,
      abi.encodeCall(
        LongPositionEmergencyCloseFacet.onCloseOrRemoveLongPositionFlashLoanWithUSDC,
        (pool, positionId, amountOut, borrowAmount, msg.sender, data)
      )
    );

    // convert collateral token to other token
    amountOut = IERC20(collateralToken).balanceOf(address(this));
    LibRouter.convertAndTransferOut(params, collateralToken, amountOut, msg.sender);

    // transfer extra USDC to revenue pool
    LibRouter.refundERC20(USDC, LibRouter.routerStorage().revenuePool);
  }

  /// @notice Hook for `closeOrRemovePositionFlashLoan`.
  /// @param pool The address of fx position pool.
  /// @param position The index of position.
  /// @param amount The amount of collateral token to withdraw.
  /// @param borrowAmount The amount of collateral token borrowed.
  /// @param recipient The address of position holder.
  /// @param data Hook data passing to `onCloseOrRemoveLongPositionFlashLoan`.
  function onCloseOrRemoveLongPositionFlashLoan(
    address pool,
    uint256 position,
    uint256 amount,
    uint256 borrowAmount,
    address recipient,
    bytes memory data
  ) external onlySelf {
    (bytes32 miscData, uint256 fxUSDAmount, address swapTarget, bytes memory swapData, , , ) = abi.decode(
      data,
      (bytes32, uint256, address, bytes, uint256, uint256[], uint256)
    );

    // swap collateral token to fxUSD
    _swap(IPool(pool).collateralToken(), fxUSD, borrowAmount, fxUSDAmount, swapTarget, swapData);

    // close or remove collateral from position
    IERC721(pool).transferFrom(recipient, address(this), position);
    {
      (, uint256 maxFxUSD) = IPool(pool).getPosition(position);
      if (fxUSDAmount >= maxFxUSD) {
        fxUSDAmount = maxFxUSD;
        // close entire position
        ILongPoolManager(poolManager).operate(pool, position, type(int256).min, type(int256).min);
      } else {
        ILongPoolManager(poolManager).operate(pool, position, -int256(amount), -int256(fxUSDAmount));
        _checkPositionDebtRatio(pool, position, miscData);
      }
    }
    IERC721(pool).transferFrom(address(this), recipient, position);

    // redeem credit note to fxUSD and swap to collateral token
    _redeemCreditNote(pool, data);

    // user only get collateral token back
    uint256 balance = IERC20(IPool(pool).collateralToken()).balanceOf(address(this));
    emit PositionOperate(pool, position, int256(balance - borrowAmount), 0, -int256(amount), -int256(fxUSDAmount));
  }

  /// @notice Hook for `closeOrRemoveLongPositionFlashLoanWithUSDC`.
  /// @param pool The address of fx position pool.
  /// @param position The index of position.
  /// @param amount The amount of collateral token to withdraw.
  /// @param borrowAmount The amount of collateral token borrowed.
  /// @param recipient The address of position holder.
  /// @param data Hook data passing to `onCloseOrRemoveLongPositionFlashLoanWithUSDC`.
  function onCloseOrRemoveLongPositionFlashLoanWithUSDC(
    address pool,
    uint256 position,
    uint256 amount,
    uint256 borrowAmount,
    address recipient,
    bytes memory data
  ) external onlySelf {
    (bytes32 miscData, uint256 USDCAmount, address swapTarget, bytes memory swapData, , , ) = abi.decode(
      data,
      (bytes32, uint256, address, bytes, uint256, uint256[], uint256)
    );

    // swap collateral token to USDC
    _swap(IPool(pool).collateralToken(), USDC, borrowAmount, USDCAmount, swapTarget, swapData);

    // close or remove collateral from position
    IERC721(pool).transferFrom(recipient, address(this), position);
    {
      IERC20(USDC).forceApprove(poolManager, IERC20(USDC).balanceOf(address(this)));
      (, uint256 maxFxUSD) = IPool(pool).getPosition(position);
      if (USDCAmount * 1e12 >= maxFxUSD) {
        USDCAmount = maxFxUSD / 1e12;
        // close entire position
        ILongPoolManager(poolManager).operate(pool, position, type(int256).min, type(int256).min, true);
      } else {
        ILongPoolManager(poolManager).operate(pool, position, -int256(amount), -int256(USDCAmount), true);
        _checkPositionDebtRatio(pool, position, miscData);
      }
    }
    IERC721(pool).transferFrom(address(this), recipient, position);

    // redeem credit note to fxUSD and swap to collateral token
    _redeemCreditNote(pool, data);

    // user only get collateral token back
    uint256 balance = IERC20(IPool(pool).collateralToken()).balanceOf(address(this));
    emit PositionOperate(pool, position, int256(balance - borrowAmount), 0, -int256(amount), -int256(USDCAmount));
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to redeem credit note to fxUSD and swap to collateral token.
  /// @param pool The address of fx position pool.
  /// @param data Hook data passing to `onCloseOrRemoveLongPositionFlashLoan` or `onCloseOrRemoveLongPositionFlashLoanWithUSDC`.
  function _redeemCreditNote(address pool, bytes memory data) internal {
    // redeem credit note to fxUSD and swap to collateral token
    address shortPool = IPool(pool).counterparty();
    address creditNote = IShortPool(shortPool).creditNote();
    uint256 creditNoteAmount = IERC20(creditNote).balanceOf(address(this));
    if (creditNoteAmount > 0) {
      IERC20(creditNote).forceApprove(shortPoolManager, creditNoteAmount);
      uint256 redeemFxUSDAmount = IShortPoolManager(shortPoolManager).redeemByCreditNote(
        shortPool,
        creditNoteAmount,
        0
      );
      (, , , , uint256 swapEncoding, uint256[] memory swapRoutes, uint256 slippage) = abi.decode(
        data,
        (bytes32, uint256, address, bytes, uint256, uint256[], uint256)
      );
      _swapWithConverter(
        fxUSD,
        redeemFxUSDAmount,
        (creditNoteAmount * (10000 - slippage)) / 10000,
        swapEncoding,
        swapRoutes
      );
    }
  }

  /// @dev Internal function to do swap.
  /// @param tokenIn The address of input token.
  /// @param tokenOut The address of output token.
  /// @param amountIn The amount of input token.
  /// @param minOut The minimum amount of output tokens should receive.
  /// @param swapTarget The address of target contract used for swap.
  /// @param swapData The calldata passed to target contract.
  /// @return amountOut The amount of output tokens received.
  function _swap(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 minOut,
    address swapTarget,
    bytes memory swapData
  ) internal returns (uint256 amountOut) {
    if (amountIn == 0) return 0;

    LibRouter.RouterStorage storage $ = LibRouter.routerStorage();
    if (!$.approvedTargets.contains(swapTarget)) {
      revert LibRouter.ErrorTargetNotApproved();
    }
    address spender = $.spenders[swapTarget];
    if (spender == address(0)) spender = swapTarget;
    LibRouter.approve(tokenIn, spender, amountIn);

    amountOut = IERC20(tokenOut).balanceOf(address(this));
    (bool success, ) = swapTarget.call(swapData);
    // below lines will propagate inner error up
    if (!success) {
      // solhint-disable-next-line no-inline-assembly
      assembly {
        let ptr := mload(0x40)
        let size := returndatasize()
        returndatacopy(ptr, 0, size)
        revert(ptr, size)
      }
    }
    amountOut = IERC20(tokenOut).balanceOf(address(this)) - amountOut;

    if (amountOut < minOut) revert ErrorInsufficientAmountSwapped();
  }

  /// @dev Internal function to do swap.
  /// @param token The address of input token.
  /// @param amountIn The amount of input token.
  /// @param minOut The minimum amount of output tokens should receive.
  /// @param encoding The encoding for swap routes.
  /// @param routes The swap routes to `MultiPathConverter`.
  /// @return amountOut The amount of output tokens received.
  function _swapWithConverter(
    address token,
    uint256 amountIn,
    uint256 minOut,
    uint256 encoding,
    uint256[] memory routes
  ) internal returns (uint256 amountOut) {
    if (amountIn == 0) return 0;

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
