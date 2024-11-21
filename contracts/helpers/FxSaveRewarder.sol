// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IRewardDistributor } from "../common/rewards/distributor/IRewardDistributor.sol";
import { IRewardSplitter } from "../interfaces/IRewardSplitter.sol";
import { IFxUSDSave } from "../interfaces/IFxUSDSave.sol";

import { PermissionedSwap } from "../common/utils/PermissionedSwap.sol";

contract FxSaveRewarder is PermissionedSwap, IRewardSplitter {
  using SafeERC20 for IERC20;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The address of `FxUSD` contract.
  address public immutable fxUSD;

  /// @notice The address of `FxUSDSave` contract.
  address public immutable fxSAVE;

  /***************
   * Constructor *
   ***************/

  constructor(address _fxSAVE) initializer {
    __Context_init();
    __ERC165_init();
    __AccessControl_init();

    fxSAVE = _fxSAVE;
    fxUSD = IFxUSDSave(_fxSAVE).yieldToken();

    IERC20(fxUSD).forceApprove(_fxSAVE, type(uint256).max);

    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IRewardSplitter
  function split(address token) external override {
    // do nothing
  }

  /// @notice Harvest base token to fxUSD by amm trading and distribute to fxSAVE.
  /// @param baseToken The address of base token to use.
  /// @param params The parameters used for trading.
  /// @return amountOut The amount of fxUSD received.
  function swapAndDistribute(address baseToken, TradingParameter memory params) external returns (uint256 amountOut) {
    uint256 amountIn = IERC20(baseToken).balanceOf(address(this));

    // swap base token to fxUSD
    amountOut = _doTrade(baseToken, fxUSD, amountIn, params);

    // deposit fxUSD to fxSAVE
    IRewardDistributor(fxSAVE).depositReward(amountOut);
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
