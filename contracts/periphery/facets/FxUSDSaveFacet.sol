// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IFxUSDSave } from "../../interfaces/IFxUSDSave.sol";
import { ILiquidityGauge } from "../../voting-escrow/interfaces/ILiquidityGauge.sol";

import { WordCodec } from "../../common/codec/WordCodec.sol";
import { LibRouter } from "../libraries/LibRouter.sol";

contract FxUSDSaveFacet {
  using SafeERC20 for IERC20;

  /*************
   * Constants *
   *************/

  /// @notice The address of USDC token.
  address private constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

  /// @notice The address of fxUSD token.
  address private constant fxUSD = 0x085780639CC2cACd35E474e71f4d000e2405d8f6;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @dev The address of `PoolManager` contract.
  address private immutable poolManager;

  /// @dev The address of `FxUSDSave` contract.
  address private immutable fxSAVE;

  /// @dev The address of fxSAVE gauge contract.
  address private immutable gauge;

  /***************
   * Constructor *
   ***************/

  constructor(address _poolManager, address _fxSAVE, address _gauge) {
    poolManager = _poolManager;
    fxSAVE = _fxSAVE;
    gauge = _gauge;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Deposit token to fxSave.
  /// @param params The parameters to convert source token to `tokenOut`.
  /// @param tokenOut The target token, USDC or fxUSD.
  /// @param minShares The minimum shares should receive.
  /// @param receiver The address of fxSAVE share recipient.
  function depositToFxSave(
    LibRouter.ConvertInParams memory params,
    address tokenOut,
    uint256 minShares,
    address receiver
  ) external {
    uint256 amountIn = LibRouter.transferInAndConvert(params, tokenOut);
    LibRouter.approve(tokenOut, fxSAVE, amountIn);
    IFxUSDSave(fxSAVE).deposit(receiver, tokenOut, amountIn, minShares);
  }

  /// @notice Deposit token to fxSave and then deposit to gauge.
  /// @param params The parameters to convert source token to `tokenOut`.
  /// @param tokenOut The target token, USDC or fxUSD.
  /// @param minShares The minimum shares should receive.
  /// @param receiver The address of gauge share recipient.
  function depositToFxSaveGauge(
    LibRouter.ConvertInParams memory params,
    address tokenOut,
    uint256 minShares,
    address receiver
  ) external {
    uint256 amountIn = LibRouter.transferInAndConvert(params, tokenOut);
    LibRouter.approve(tokenOut, fxSAVE, amountIn);
    uint256 shares = IFxUSDSave(fxSAVE).deposit(address(this), tokenOut, amountIn, minShares);
    LibRouter.approve(fxSAVE, gauge, shares);
    ILiquidityGauge(gauge).deposit(shares, receiver);
  }

  /// @notice Burn fxSAVE shares and then convert USDC and fxUSD to another token.
  /// @param fxusdParams The parameters to convert fxUSD to target token.
  /// @param usdcParams The parameters to convert USDC to target token.
  /// @param amountIn The amount of fxSAVE to redeem.
  /// @param receiver The address of token recipient.
  function redeemFromFxSave(
    LibRouter.ConvertOutParams memory fxusdParams,
    LibRouter.ConvertOutParams memory usdcParams,
    uint256 amountIn,
    address receiver
  ) external {
    IERC20(fxSAVE).safeTransferFrom(msg.sender, address(this), amountIn);
    (uint256 amountFxUSD, uint256 amountUSDC) = IFxUSDSave(fxSAVE).redeem(address(this), amountIn);
    LibRouter.convertAndTransferOut(fxusdParams, fxUSD, amountFxUSD, receiver);
    LibRouter.convertAndTransferOut(usdcParams, USDC, amountUSDC, receiver);
  }

  /// @notice Burn fxSAVE shares from gauge and then convert USDC and fxUSD to another token.
  /// @param fxusdParams The parameters to convert fxUSD to target token.
  /// @param usdcParams The parameters to convert USDC to target token.
  /// @param amountIn The amount of fxSAVE to redeem.
  /// @param receiver The address of token recipient.
  function redeemFromFxSaveGauge(
    LibRouter.ConvertOutParams memory fxusdParams,
    LibRouter.ConvertOutParams memory usdcParams,
    uint256 amountIn,
    address receiver
  ) external {
    IERC20(gauge).safeTransferFrom(msg.sender, address(this), amountIn);
    ILiquidityGauge(gauge).withdraw(amountIn);
    (uint256 amountFxUSD, uint256 amountUSDC) = IFxUSDSave(fxSAVE).redeem(address(this), amountIn);
    LibRouter.convertAndTransferOut(fxusdParams, fxUSD, amountFxUSD, receiver);
    LibRouter.convertAndTransferOut(usdcParams, USDC, amountUSDC, receiver);
  }
}
