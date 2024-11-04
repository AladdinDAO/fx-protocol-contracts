// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/IERC20Upgradeable.sol";

import { IRewardDistributor } from "../common/rewards/distributor/IRewardDistributor.sol";
import { IRewardSplitter } from "../interfaces/IRewardSplitter.sol";
import { IStakedFxUSD } from "../interfaces/IStakedFxUSD.sol";

import { PermissionedSwap } from "../common/utils/PermissionedSwap.sol";

contract SfxUSDRewarder is PermissionedSwap, IRewardSplitter {
  using SafeERC20Upgradeable for IERC20Upgradeable;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The address of `FxUSD` contract.
  address public immutable fxUSD;

  /// @notice The address of `StakedFxUSD` contract.
  address public immutable sfxUSD;

  /***************
   * Constructor *
   ***************/

  constructor(address _sfxUSD) initializer {
    __Context_init();
    __ERC165_init();
    __AccessControl_init();

    sfxUSD = _sfxUSD;
    fxUSD = IStakedFxUSD(_sfxUSD).yieldToken();

    IERC20Upgradeable(fxUSD).safeApprove(sfxUSD, type(uint256).max);

    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IRewardSplitter
  function split(address token) external override {
    // do nothing
  }

  /// @notice Harvest base token to fxUSD by amm trading and distribute to sfxUSD.
  /// @param baseToken The address of base token to use.
  /// @param params The parameters used for trading.
  /// @return amountOut The amount of fxUSD received.
  function swapAndDistribute(address baseToken, TradingParameter memory params) external returns (uint256 amountOut) {
    uint256 amountIn = IERC20Upgradeable(baseToken).balanceOf(address(this));

    // swap base token to fxUSD
    amountOut = _doTrade(baseToken, fxUSD, amountIn, params);

    // deposit fxUSD to sfxUSD
    IRewardDistributor(sfxUSD).depositReward(amountOut);
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Withdraw base token to someone else.
  /// @dev This should be only used when we are retiring this contract.
  /// @param baseToken The address of base token.
  function withdraw(address baseToken, address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
    uint256 amountIn = IERC20Upgradeable(baseToken).balanceOf(address(this));
    IERC20Upgradeable(baseToken).safeTransfer(recipient, amountIn);
  }
}
