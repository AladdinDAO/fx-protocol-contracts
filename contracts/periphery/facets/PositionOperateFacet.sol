// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { ILongPoolManager } from "../../interfaces/ILongPoolManager.sol";
import { ILongPool } from "../../interfaces/ILongPool.sol";
import { IPoolConfiguration } from "../../interfaces/IPoolConfiguration.sol";
import { IShortPoolManager } from "../../interfaces/IShortPoolManager.sol";
import { IShortPool } from "../../interfaces/IShortPool.sol";

import { LibRouter } from "../libraries/LibRouter.sol";

contract PositionOperateFacet {
  using SafeERC20 for IERC20;

  /**********
   * Events *
   **********/

  /// @notice Emitted when a position is operated.
  /// @param pool The address of the pool.
  /// @param user The address of the user.
  /// @param positionId The index of the position.
  /// @param deltaColls The amount of collateral transferred from/to the user. Negative value means the user is transferring collateral to the position.
  /// @param deltaDebts The amount of debt transferred from/to the user. Negative value means the user is transferring debt to the position.
  event Operate(address indexed pool, address indexed user, uint256 positionId, int256 deltaColls, int256 deltaDebts);

  /**********
   * Errors *
   **********/

  /// @dev Unauthorized reentrant call.
  error ReentrancyGuardReentrantCall();

  /*************
   * Constants *
   *************/

  /// @dev The precision used for various calculation.
  uint256 private constant PRECISION = 1e18;

  /// @dev The precision used to compute fees.
  uint256 private constant FEE_PRECISION = 1e9;

  /// @dev The address of fxUSD token.
  address private constant fxUSD = 0x085780639CC2cACd35E474e71f4d000e2405d8f6;

  /// @dev The address of long pool manager.
  address private constant longPoolManager = 0x250893CA4Ba5d05626C785e8da758026928FCD24;

  /// @dev The address of short pool manager.
  address private constant shortPoolManager = 0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D;

  /// @dev The address of PoolConfiguration.
  address private constant configuration = 0x16b334f2644cc00b85DB1A1efF0C2C395e00C28d;

  /***********
   * Structs *
   ***********/

  /// @notice The parameters to borrow from long pool.
  /// @param pool The address of long pool.
  /// @param positionId The id of the position.
  /// @param borrowAmount The amount of collateral token to borrow.
  struct BorrowFromLongParams {
    address pool;
    uint256 positionId;
    uint256 borrowAmount;
  }

  /// @notice The parameters to repay to long pool.
  /// @param pool The address of long pool.
  /// @param positionId The id of the position.
  /// @param withdrawAmount The amount of collateral token to withdraw.
  struct RepayToLongParams {
    address pool;
    uint256 positionId;
    uint256 withdrawAmount;
  }

  /*************
   * Modifiers *
   *************/

  /// @dev Modifier to prevent reentrancy.
  modifier nonReentrant() {
    LibRouter.RouterStorage storage $ = LibRouter.routerStorage();
    if ($.reentrantContext == LibRouter.HAS_ENTRANT) {
      revert ReentrancyGuardReentrantCall();
    }
    $.reentrantContext = LibRouter.HAS_ENTRANT;
    _;
    $.reentrantContext = LibRouter.NOT_ENTRANT;
  }

  /***************
   * Constructor *
   ***************/

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Borrow collateral token from long pool with any tokens.
  /// @param convertInParams The parameters to convert source token to collateral token.
  /// @param borrowParams The parameters to borrow from long pool.
  /// @return positionId The actual position id.
  function borrowFromLong(
    LibRouter.ConvertInParams memory convertInParams,
    BorrowFromLongParams memory borrowParams
  ) external payable nonReentrant returns (uint256) {
    address collateralToken = ILongPool(borrowParams.pool).collateralToken();
    uint256 amountIn;
    if (convertInParams.amount > 0) {
      amountIn = LibRouter.transferInAndConvert(convertInParams, collateralToken);
    }

    if (borrowParams.positionId > 0) {
      IERC721(borrowParams.pool).transferFrom(msg.sender, address(this), borrowParams.positionId);
    }
    if (amountIn > 0) {
      IERC20(collateralToken).forceApprove(longPoolManager, amountIn);
    }
    borrowParams.positionId = ILongPoolManager(longPoolManager).operate(
      borrowParams.pool,
      borrowParams.positionId,
      int256(amountIn),
      int256(borrowParams.borrowAmount)
    );
    IERC721(borrowParams.pool).transferFrom(address(this), msg.sender, borrowParams.positionId);

    emit Operate(
      borrowParams.pool,
      msg.sender,
      borrowParams.positionId,
      int256(amountIn),
      int256(borrowParams.borrowAmount)
    );

    // transfer borrowed fxUSD to caller
    LibRouter.refundERC20(fxUSD, msg.sender);

    return borrowParams.positionId;
  }

  /// @notice Repay collateral token to long pool with any tokens.
  /// @param convertInParams The parameters to convert source token to collateral token.
  /// @param repayParams The parameters to repay to long pool.
  function repayToLong(
    LibRouter.ConvertInParams memory convertInParams,
    RepayToLongParams memory repayParams
  ) external payable nonReentrant {
    // convert and repay to long pool
    _repayToLong(convertInParams, repayParams);

    // transfer withdrawn collateral token to caller
    address collateralToken = ILongPool(repayParams.pool).collateralToken();
    LibRouter.refundERC20(collateralToken, msg.sender);

    // transfer extra fxUSD to caller
    LibRouter.refundERC20(fxUSD, msg.sender);
  }

  /// @notice Repay collateral token to long pool with any tokens.
  /// @param convertInParams The parameters to convert source token to collateral token.
  /// @param repayParams The parameters to repay to long pool.
  function repayToLongAndZapOut(
    LibRouter.ConvertInParams memory convertInParams,
    RepayToLongParams memory repayParams,
    LibRouter.ConvertOutParams memory convertOutParams
  ) external payable nonReentrant {
    // convert and repay to long pool
    _repayToLong(convertInParams, repayParams);

    // transfer withdrawn collateral token to caller
    address collateralToken = ILongPool(repayParams.pool).collateralToken();
    uint256 amountOut = IERC20(collateralToken).balanceOf(address(this));
    LibRouter.convertAndTransferOut(convertOutParams, collateralToken, amountOut, msg.sender);

    // transfer extra fxUSD to caller
    LibRouter.refundERC20(fxUSD, msg.sender);
  }

  /// @dev Internal function to repay to long pool.
  /// @param convertInParams The parameters to convert source token to collateral token.
  /// @param repayParams The parameters to repay to long pool.
  function _repayToLong(
    LibRouter.ConvertInParams memory convertInParams,
    RepayToLongParams memory repayParams
  ) internal {
    uint256 amountIn;
    if (convertInParams.amount > 0) {
      amountIn = LibRouter.transferInAndConvert(convertInParams, fxUSD);
    }

    IERC721(repayParams.pool).transferFrom(msg.sender, address(this), repayParams.positionId);
    if (amountIn > 0) {
      IERC20(fxUSD).forceApprove(longPoolManager, amountIn);
    }
    // repay * (1 + repayFeeRatio) <= amountIn
    // repay <= amountIn / (1 + repayFeeRatio)
    (, , , uint256 repayFeeRatio) = IPoolConfiguration(configuration).getPoolFeeRatio(repayParams.pool, address(this));
    uint256 actualRepay = (amountIn * FEE_PRECISION) / (FEE_PRECISION + repayFeeRatio);

    // check whether it is fully repay
    address collateralToken = ILongPool(repayParams.pool).collateralToken();
    int256 deltaColl = -int256(repayParams.withdrawAmount);
    int256 deltaDebts = -int256(actualRepay);
    (uint256 colls, uint256 debts) = ILongPool(repayParams.pool).getPosition(repayParams.positionId);
    uint256 scalingFactor = ILongPoolManager(longPoolManager).getTokenScalingFactor(collateralToken);
    colls = _scaleDown(colls, scalingFactor);
    if (actualRepay >= debts && repayParams.withdrawAmount >= colls) {
      deltaColl = type(int256).min;
      deltaDebts = type(int256).min;
    }
    ILongPoolManager(longPoolManager).operate(repayParams.pool, repayParams.positionId, deltaColl, deltaDebts);
    IERC721(repayParams.pool).transferFrom(address(this), msg.sender, repayParams.positionId);

    // emit event for operate
    if (deltaColl == type(int256).min) {
      deltaColl = -int256(colls);
      deltaDebts = -int256(debts);
    }
    emit Operate(repayParams.pool, msg.sender, repayParams.positionId, deltaColl, deltaDebts);
  }

  /// @dev Internal function to scaler down for `uint256`, rounding down.
  function _scaleDown(uint256 value, uint256 scale) internal pure returns (uint256) {
    return (value * PRECISION) / scale;
  }
}
