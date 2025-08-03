// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { IMultiPathConverter } from "../../helpers/interfaces/IMultiPathConverter.sol";
import { IShortPoolManager } from "../../interfaces/IShortPoolManager.sol";
import { IShortPool } from "../../interfaces/IShortPool.sol";
import { IPositionOperateFacet } from "./IPositionOperateFacet.sol";

import { WordCodec } from "../../common/codec/WordCodec.sol";
import { LibRouter } from "../libraries/LibRouter.sol";
import { MorphoFlashLoanFacetBase } from "./MorphoFlashLoanFacetBase.sol";

contract ShortPositionOperateFlashLoanFacet is MorphoFlashLoanFacetBase, IPositionOperateFacet {
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

  address private constant fxUSD = 0x085780639CC2cACd35E474e71f4d000e2405d8f6;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @dev The address of `PoolManager` contract.
  address private immutable poolManager;

  /***************
   * Constructor *
   ***************/

  constructor(address _morpho, address _poolManager, address _whitelist) MorphoFlashLoanFacetBase(_morpho, _whitelist) {
    poolManager = _poolManager;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Open a new position or add fxUSD to position with any tokens.
  /// @param params The parameters to convert source token to fxUSD.
  /// @param pool The address of fx position pool.
  /// @param positionId The index of position.
  /// @param debtTokenBorrowAmount The amount of debt token to borrow.
  /// @param data Hook data passing to `onOpenOrAddShortPositionFlashLoan`.
  function openOrAddShortPositionFlashLoan(
    LibRouter.ConvertInParams memory params,
    address pool,
    uint256 positionId,
    uint256 debtTokenBorrowAmount,
    bytes calldata data
  ) external payable nonReentrant onlyTopLevelCall {
    // flashloan debt token
    // swap debt token to fxUSD
    // supply fxUSD and borrow debt token to repay flashloan
    uint256 fxUSDSupplyAmount = LibRouter.transferInAndConvert(params, fxUSD);
    address debtToken = IShortPool(pool).debtToken();
    _invokeFlashLoan(
      debtToken,
      debtTokenBorrowAmount,
      abi.encodeCall(
        ShortPositionOperateFlashLoanFacet.onOpenOrAddShortPositionFlashLoan,
        (pool, positionId, fxUSDSupplyAmount, debtTokenBorrowAmount, msg.sender, data)
      )
    );
    // transfer extra debt token to revenue pool
    LibRouter.refundERC20(debtToken, LibRouter.routerStorage().revenuePool);
  }

  /// @notice Close a position or remove fxUSD from position.
  /// @param params The parameters to convert fxUSD to target token.
  /// @param positionId The index of position.
  /// @param pool The address of fx position pool.
  /// @param fxUSDWithdrawAmount The amount of fxUSD to withdraw from position.
  /// @param debtTokenBorrowAmount The amount of debt token to borrow.
  /// @param data Hook data passing to `onCloseOrRemoveShortPositionFlashLoan`.
  function closeOrRemoveShortPositionFlashLoan(
    LibRouter.ConvertOutParams memory params,
    address pool,
    uint256 positionId,
    uint256 fxUSDWithdrawAmount,
    uint256 debtTokenBorrowAmount,
    bytes calldata data
  ) external nonReentrant onlyTopLevelCall {
    // flashloan debt token
    // repay debt token and get fxUSD back
    // swap fxUSD to debt token to repay flashloan
    address debtToken = IShortPool(pool).debtToken();
    _invokeFlashLoan(
      debtToken,
      debtTokenBorrowAmount,
      abi.encodeCall(
        ShortPositionOperateFlashLoanFacet.onCloseOrRemoveShortPositionFlashLoan,
        (pool, positionId, fxUSDWithdrawAmount, debtTokenBorrowAmount, msg.sender, data)
      )
    );

    // convert all fxUSD to target token
    LibRouter.convertAndTransferOut(params, fxUSD, IERC20(fxUSD).balanceOf(address(this)), msg.sender);

    // transfer extra debt token to revenue pool
    LibRouter.refundERC20(debtToken, LibRouter.routerStorage().revenuePool);
  }

  /// @notice Hook for `onOpenOrAddShortPositionFlashLoan`.
  /// @param pool The address of fx position pool.
  /// @param position The index of position.
  /// @param fxUSDSupplyAmount The amount of fxUSD to supply.
  /// @param debtTokenBorrowAmount The amount of debt token borrowed.
  /// @param recipient The address of position holder.
  /// @param data Hook data passing to `onOpenOrAddShortPositionFlashLoan`.
  function onOpenOrAddShortPositionFlashLoan(
    address pool,
    uint256 position,
    uint256 fxUSDSupplyAmount,
    uint256 debtTokenBorrowAmount,
    address recipient,
    bytes memory data
  ) external onlySelf {
    (bytes32 miscData, uint256 minFxUSD, address swapTarget, bytes memory swapData) = abi.decode(
      data,
      (bytes32, uint256, address, bytes)
    );

    uint256 userFxUSDSupplyAmount = fxUSDSupplyAmount;
    // swap borrowed debt token to fxUSD
    fxUSDSupplyAmount += _swap(
      IShortPool(pool).debtToken(),
      fxUSD,
      debtTokenBorrowAmount,
      minFxUSD,
      swapTarget,
      swapData
    );

    // open or add collateral to position
    if (position != 0) {
      IERC721(pool).transferFrom(recipient, address(this), position);
    }
    LibRouter.approve(fxUSD, poolManager, fxUSDSupplyAmount);
    // borrow 0.0001% more to avoid rounding error in PoolManager
    debtTokenBorrowAmount = (debtTokenBorrowAmount * 1000001) / 1000000;
    position = IShortPoolManager(poolManager).operate(
      pool,
      position,
      int256(fxUSDSupplyAmount),
      int256(debtTokenBorrowAmount)
    );
    _checkPositionDebtRatio(pool, position, miscData);
    IERC721(pool).transferFrom(address(this), recipient, position);

    // user supply fxUSD to position and get nothing back
    emit PositionOperate(
      pool,
      position,
      -int256(userFxUSDSupplyAmount),
      0,
      int256(fxUSDSupplyAmount),
      int256(debtTokenBorrowAmount)
    );
  }

  /// @notice Hook for `onCloseOrRemoveShortPositionFlashLoan`.
  /// @param pool The address of fx position pool.
  /// @param position The index of position.
  /// @param fxUSDWithdrawAmount The amount of fxUSD to withdraw.
  /// @param debtTokenBorrowAmount The amount of debt token borrowed.
  /// @param recipient The address of position holder.
  /// @param data Hook data passing to `onCloseOrRemoveShortPositionFlashLoan`.
  function onCloseOrRemoveShortPositionFlashLoan(
    address pool,
    uint256 position,
    uint256 fxUSDWithdrawAmount,
    uint256 debtTokenBorrowAmount,
    address recipient,
    bytes memory data
  ) external onlySelf {
    (bytes32 miscData, uint256 swapAmount, address swapTarget, bytes memory swapData) = abi.decode(
      data,
      (bytes32, uint256, address, bytes)
    );

    address debtToken = IShortPool(pool).debtToken();
    LibRouter.approve(debtToken, poolManager, debtTokenBorrowAmount);

    // close or remove fxUSD from position
    IERC721(pool).transferFrom(recipient, address(this), position);
    (uint256 maxFxUSD, ) = IShortPool(pool).getPosition(position);
    if (fxUSDWithdrawAmount >= maxFxUSD) {
      fxUSDWithdrawAmount = maxFxUSD;
      // close entire position
      IShortPoolManager(poolManager).operate(pool, position, type(int256).min, type(int256).min);
    } else {
      IShortPoolManager(poolManager).operate(
        pool,
        position,
        -int256(fxUSDWithdrawAmount),
        -int256(debtTokenBorrowAmount)
      );
      _checkPositionDebtRatio(pool, position, miscData);
    }
    IERC721(pool).transferFrom(address(this), recipient, position);

    // swap fxUSD to debt token to repay flashloan
    _swap(fxUSD, debtToken, swapAmount, debtTokenBorrowAmount, swapTarget, swapData);

    emit PositionOperate(
      pool,
      position,
      int256(fxUSDWithdrawAmount - swapAmount),
      0,
      -int256(fxUSDWithdrawAmount),
      -int256(debtTokenBorrowAmount)
    );
  }

  /**********************
   * Internal Functions *
   **********************/

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

  /// @dev Internal function to check debt ratio for the position.
  /// @param pool The address of fx position pool.
  /// @param positionId The index of the position.
  /// @param miscData The encoded data for debt ratio range.
  function _checkPositionDebtRatio(address pool, uint256 positionId, bytes32 miscData) internal view {
    uint256 debtRatio = IShortPool(pool).getPositionDebtRatio(positionId);
    uint256 minDebtRatio = miscData.decodeUint(0, 60);
    uint256 maxDebtRatio = miscData.decodeUint(60, 60);
    if (debtRatio < minDebtRatio || debtRatio > maxDebtRatio) {
      revert ErrorDebtRatioOutOfRange();
    }
  }
}
