// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IFxUSDBasePool } from "../../interfaces/IFxUSDBasePool.sol";
import { IFxShareableRebalancePool } from "../../v2/interfaces/IFxShareableRebalancePool.sol";
import { IFxUSD } from "../../v2/interfaces/IFxUSD.sol";
import { ILiquidityGauge } from "../../voting-escrow/interfaces/ILiquidityGauge.sol";

import { WordCodec } from "../../common/codec/WordCodec.sol";
import { LibRouter } from "../libraries/LibRouter.sol";

contract L2FxUSDBasePoolFacet {
  using SafeERC20 for IERC20;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @dev The address of `FxUSDBasePool` contract.
  address private immutable fxBASE;

  /// @notice The address of fxUSD token.
  address private immutable fxUSD;

  /***************
   * Constructor *
   ***************/

  constructor(address _fxBASE, address _fxUSD) {
    fxBASE = _fxBASE;
    fxUSD = _fxUSD;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Migrate fxUSD from rebalance pool to fxBASE gauge.
  /// @param pool The address of rebalance pool.
  /// @param amountIn The amount of rebalance pool shares to migrate.
  /// @param minShares The minimum shares should receive.
  /// @param receiver The address of fxBASE share recipient.
  function migrateToFxBaseGauge(address pool, address gauge, uint256 amountIn, uint256 minShares, address receiver) external {
    LibRouter.ensureWhitelisted(gauge);
    IFxShareableRebalancePool(pool).withdrawFrom(msg.sender, amountIn, address(this));
    address baseToken = IFxShareableRebalancePool(pool).baseToken();
    address asset = IFxShareableRebalancePool(pool).asset();
    LibRouter.approve(asset, fxUSD, amountIn);
    IFxUSD(fxUSD).wrap(baseToken, amountIn, address(this));
    LibRouter.approve(fxUSD, fxBASE, amountIn);
    uint256 shares = IFxUSDBasePool(fxBASE).deposit(address(this), fxUSD, amountIn, minShares);
    LibRouter.approve(fxBASE, gauge, shares);
    ILiquidityGauge(gauge).deposit(shares, receiver);
  }

  /// @notice Deposit token to fxBase and then deposit to gauge.
  /// @param params The parameters to convert source token to `tokenOut`.
  /// @param tokenOut The target token, USDC or fxUSD.
  /// @param minShares The minimum shares should receive.
  /// @param receiver The address of gauge share recipient.
  function depositToFxBaseGauge(
    LibRouter.ConvertInParams memory params,
    address gauge,
    address tokenOut,
    uint256 minShares,
    address receiver
  ) external payable {
    LibRouter.ensureWhitelisted(gauge);
    uint256 amountIn = LibRouter.transferInAndConvert(params, tokenOut);
    LibRouter.approve(tokenOut, fxBASE, amountIn);
    uint256 shares = IFxUSDBasePool(fxBASE).deposit(address(this), tokenOut, amountIn, minShares);
    LibRouter.approve(fxBASE, gauge, shares);
    ILiquidityGauge(gauge).deposit(shares, receiver);
  }
}
