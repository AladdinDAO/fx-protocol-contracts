// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IMultipleRewardDistributor } from "../common/rewards/distributor/IMultipleRewardDistributor.sol";
import { IRewardSplitter } from "../interfaces/IRewardSplitter.sol";

import { PermissionedSwap } from "../common/utils/PermissionedSwap.sol";

contract GaugeRewarder is PermissionedSwap, IRewardSplitter {
  using SafeERC20 for IERC20;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The address of `FxUSD` contract.
  address public immutable fxUSD;

  /// @notice The address of `LiquidityGauge` contract.
  address public immutable gauge;

  /***************
   * Constructor *
   ***************/

  constructor(address _gauge) initializer {
    __Context_init();
    __ERC165_init();
    __AccessControl_init();

    gauge = _gauge;

    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IRewardSplitter
  function split(address token) external override {
    // do nothing
  }

  /// @notice Harvest base token to fxUSD by amm trading and distribute to fxBASE.
  /// @param baseToken The address of base token to use.
  /// @param params The parameters used for trading.
  /// @return amountOut The amount of fxUSD received.
  function swapAndDistribute(
    address baseToken,
    address targetToken,
    TradingParameter memory params
  ) external returns (uint256 amountOut) {
    uint256 amountIn = IERC20(baseToken).balanceOf(address(this));

    // swap base token to target
    amountOut = _doTrade(baseToken, targetToken, amountIn, params);

    // deposit target token to gauge
    IERC20(targetToken).forceApprove(gauge, amountOut);
    IMultipleRewardDistributor(gauge).depositReward(targetToken, amountOut);
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Withdraw base token to someone else.
  /// @dev This should be only used when we are retiring this contract.
  /// @param baseToken The address of base token.
  function withdraw(address baseToken, address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
    uint256 amountIn = IERC20(baseToken).balanceOf(address(this));
    IERC20(baseToken).safeTransfer(recipient, amountIn);
  }
}
