// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts-v4/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-v4/token/ERC20/utils/SafeERC20.sol";
import { IERC721 } from "@openzeppelin/contracts-v4/token/ERC721/IERC721.sol";

import { IMultiPathConverter } from "../../helpers/interfaces/IMultiPathConverter.sol";
import { IBalancerVault } from "../../interfaces/Balancer/IBalancerVault.sol";
import { IPoolManager } from "../../interfaces/IPoolManager.sol";
import { IFxMarketV2 } from "../../v2/interfaces/IFxMarketV2.sol";
import { IFxUSD } from "../../v2/interfaces/IFxUSD.sol";

import { LibRouter } from "../libraries/LibRouter.sol";

contract MigrateFacet {
  using SafeERC20 for IERC20;

  /**********
   * Errors *
   **********/

  /// @dev Thrown when the caller is not self.
  error ErrorNotFromSelf();

  /// @dev Thrown when the amount of tokens swapped are not enough.
  error ErrorInsufficientAmountSwapped();

  /*************
   * Constants *
   *************/

  address private constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

  address private constant fxUSD = 0x085780639CC2cACd35E474e71f4d000e2405d8f6;

  address private constant wstETHMarket = 0xAD9A0E7C08bc9F747dF97a3E7E7f620632CB6155;

  address private constant wstETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;

  address private constant fstETH = 0xD6B8162e2fb9F3EFf09bb8598ca0C8958E33A23D;

  address private constant xstETH = 0x5a097b014C547718e79030a077A91Ae37679EfF5;

  address private constant sfrxETHMarket = 0x714B853b3bA73E439c652CfE79660F329E6ebB42;

  address private constant sfrxETH = 0xac3E018457B222d93114458476f3E3416Abbe38F;

  address private constant ffrxETH = 0xa87F04c9743Fd1933F82bdDec9692e9D97673769;

  address private constant xfrxETH = 0x2bb0C32101456F5960d4e994Bac183Fe0dc6C82c;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @dev The address of Balancer V2 Vault.
  address private immutable balancer;

  /// @dev The address of `PoolManager` contract.
  address private immutable poolManager;

  /// @dev The address of `MultiPathConverter` contract.
  address private immutable converter;

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

  function migrateXstETHPosition(
    address pool,
    uint256 xTokenAmount,
    uint256 borrowAmount,
    bytes calldata data
  ) external onFlashLoan {
    IERC20(xstETH).safeTransferFrom(msg.sender, address(this), xTokenAmount);

    address[] memory tokens = new address[](1);
    uint256[] memory amounts = new uint256[](1);
    tokens[0] = USDC;
    amounts[0] = borrowAmount;
    IBalancerVault(balancer).flashLoan(
      address(this),
      tokens,
      amounts,
      abi.encodeCall(MigrateFacet.onMigrateXstETHPosition, (pool, xTokenAmount, borrowAmount, msg.sender, data))
    );

    // refund USDC to caller
    LibRouter.refundERC20(USDC, msg.sender);
  }

  function migrateXfrxETHPosition(
    address pool,
    uint256 xTokenAmount,
    uint256 borrowAmount,
    bytes calldata data
  ) external onFlashLoan {
    IERC20(xfrxETH).safeTransferFrom(msg.sender, address(this), xTokenAmount);

    address[] memory tokens = new address[](1);
    uint256[] memory amounts = new uint256[](1);
    tokens[0] = USDC;
    amounts[0] = borrowAmount;
    IBalancerVault(balancer).flashLoan(
      address(this),
      tokens,
      amounts,
      abi.encodeCall(MigrateFacet.onMigrateXfrxETHPosition, (pool, xTokenAmount, borrowAmount, msg.sender, data))
    );

    // refund USDC to caller
    LibRouter.refundERC20(USDC, msg.sender);
  }

  function onMigrateXstETHPosition(
    address pool,
    uint256 xTokenAmount,
    uint256 borrowAmount,
    address recipient,
    bytes memory data
  ) external onlySelf {
    uint256 fTokenAmount = (xTokenAmount * IERC20(fstETH).totalSupply()) / IERC20(xstETH).totalSupply();

    // swap USDC to fxUSD
    fTokenAmount = _swapUSDCToFxUSD(borrowAmount, fTokenAmount, data);

    // unwrap fxUSD as fToken
    IFxUSD(fxUSD).unwrap(wstETH, fTokenAmount, address(this));

    uint256 wstETHAmount;
    {
      wstETHAmount = IFxMarketV2(wstETHMarket).redeemXToken(xTokenAmount, address(this), 0);
      (uint256 baseOut, uint256 bonus) = IFxMarketV2(wstETHMarket).redeemFToken(fTokenAmount, address(this), 0);
      wstETHAmount += baseOut + bonus;
    }

    // since we need to swap back to USDC, mint 0.5% more fxUSD to cover slippage.
    fTokenAmount = (fTokenAmount * 1005) / 1000;

    IERC20(wstETH).safeApprove(poolManager, 0);
    IERC20(wstETH).safeApprove(poolManager, wstETHAmount);
    uint256 position = IPoolManager(poolManager).operate(pool, 0, int256(wstETHAmount), int256(fTokenAmount));
    IERC721(pool).transferFrom(address(this), recipient, position);

    // swap fxUSD to USDC and pay debts
    _swapFxUSDToUSDC(IERC20(fxUSD).balanceOf(address(this)), borrowAmount, data);
  }

  function onMigrateXfrxETHPosition(
    address pool,
    uint256 xTokenAmount,
    uint256 borrowAmount,
    address recipient,
    bytes memory data
  ) external onlySelf {
    uint256 fTokenAmount = (xTokenAmount * IERC20(ffrxETH).totalSupply()) / IERC20(xfrxETH).totalSupply();

    // swap USDC to fxUSD
    fTokenAmount = _swapUSDCToFxUSD(borrowAmount, fTokenAmount, data);

    // unwrap fxUSD as fToken
    IFxUSD(fxUSD).unwrap(sfrxETH, fTokenAmount, address(this));

    uint256 wstETHAmount;
    {
      // redeem
      wstETHAmount = IFxMarketV2(sfrxETHMarket).redeemXToken(xTokenAmount, address(this), 0);
      (uint256 baseOut, uint256 bonus) = IFxMarketV2(sfrxETHMarket).redeemFToken(fTokenAmount, address(this), 0);
      wstETHAmount += baseOut + bonus;
      // swap sfrxETH to wstETH
      wstETHAmount = _swapSfrxETHToWstETH(wstETHAmount, 0, data);
    }

    // since we need to swap back to USDC, mint 0.5% more fxUSD to cover slippage.
    fTokenAmount = (fTokenAmount * 1005) / 1000;

    IERC20(wstETH).safeApprove(poolManager, 0);
    IERC20(wstETH).safeApprove(poolManager, wstETHAmount);
    uint256 position = IPoolManager(poolManager).operate(pool, 0, int256(wstETHAmount), int256(fTokenAmount));
    IERC721(pool).transferFrom(address(this), recipient, position);

    // swap fxUSD to USDC and pay debts
    _swapFxUSDToUSDC(IERC20(fxUSD).balanceOf(address(this)), borrowAmount, data);
  }

  function _swapUSDCToFxUSD(
    uint256 amountUSDC,
    uint256 minFxUSD,
    bytes memory data
  ) internal returns (uint256 amountFxUSD) {
    (uint256 swapEncoding, uint256[] memory swapRoutes) = abi.decode(data, (uint256, uint256[]));
    return _swap(USDC, amountUSDC, minFxUSD, swapEncoding, swapRoutes);
  }

  function _swapFxUSDToUSDC(
    uint256 amountFxUSD,
    uint256 minUSDC,
    bytes memory data
  ) internal returns (uint256 amountUSDC) {
    (, , uint256 swapEncoding, uint256[] memory swapRoutes) = abi.decode(
      data,
      (uint256, uint256[], uint256, uint256[])
    );
    return _swap(fxUSD, amountFxUSD, minUSDC, swapEncoding, swapRoutes);
  }

  function _swapSfrxETHToWstETH(
    uint256 amountSfrxETH,
    uint256 minWstETH,
    bytes memory data
  ) internal returns (uint256 amountWstETH) {
    (, , , , uint256 swapEncoding, uint256[] memory swapRoutes) = abi.decode(
      data,
      (uint256, uint256[], uint256, uint256[], uint256, uint256[])
    );
    return _swap(sfrxETH, amountSfrxETH, minWstETH, swapEncoding, swapRoutes);
  }

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
}
