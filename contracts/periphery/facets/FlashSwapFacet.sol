// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { IMultiPathConverter } from "../../helpers/interfaces/IMultiPathConverter.sol";
import { IBalancerVault } from "../../interfaces/Balancer/IBalancerVault.sol";
import { IPoolManager } from "../../interfaces/IPoolManager.sol";
import { IPool } from "../../interfaces/IPool.sol";

import { LibRouter } from "../libraries/LibRouter.sol";

contract FlashSwapFacet {
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
        FlashSwapFacet.onOpenOrAddPositionFlashLoan,
        (pool, positionId, amountIn, borrowAmount, msg.sender, data)
      )
    );

    // refund collateral token to caller
    LibRouter.refundERC20(IPool(pool).collateralToken(), msg.sender);
  }

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
        FlashSwapFacet.onCloseOrRemovePositionFlashLoan,
        (pool, positionId, amountOut, borrowAmount, msg.sender, data)
      )
    );

    // convert collateral token to other token
    amountOut = IERC20(collateralToken).balanceOf(address(this));
    LibRouter.convertAndTransferOut(params, collateralToken, amountOut, msg.sender);

    // refund rest fxUSD and leveraged token
    LibRouter.refundERC20(fxUSD, msg.sender);
  }

  function onOpenOrAddPositionFlashLoan(
    address pool,
    uint256 position,
    uint256 amount,
    uint256 repayAmount,
    address recipient,
    bytes memory data
  ) external onlySelf {
    (uint256 fxUSDAmount, uint256 swapEncoding, uint256[] memory swapRoutes) = abi.decode(
      data,
      (uint256, uint256, uint256[])
    );

    // open or add collateral to position
    if (position != 0) {
      IERC721(pool).transferFrom(recipient, address(this), position);
    }
    LibRouter.approve(IPool(pool).collateralToken(), poolManager, amount);
    position = IPoolManager(poolManager).operate(pool, position, int256(amount), int256(fxUSDAmount));
    IERC721(pool).transferFrom(address(this), recipient, position);

    // swap fxUSD to collateral token
    _swap(fxUSD, fxUSDAmount, repayAmount, swapEncoding, swapRoutes);
  }

  function onCloseOrRemovePositionFlashLoan(
    address pool,
    uint256 position,
    uint256 amount,
    uint256 repayAmount,
    address recipient,
    bytes memory data
  ) external onlySelf {
    (uint256 fxUSDAmount, uint256 swapEncoding, uint256[] memory swapRoutes) = abi.decode(
      data,
      (uint256, uint256, uint256[])
    );

    // swap collateral token to fxUSD
    _swap(IPool(pool).collateralToken(), repayAmount, fxUSDAmount, swapEncoding, swapRoutes);

    // close or remove collateral from position
    IERC721(pool).transferFrom(recipient, address(this), position);
    IPoolManager(poolManager).operate(pool, position, -int256(amount), -int256(fxUSDAmount));
    IERC721(pool).transferFrom(address(this), recipient, position);
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
