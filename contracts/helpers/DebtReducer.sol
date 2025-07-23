// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IPoolManager } from "../interfaces/IPoolManager.sol";

import { PermissionedSwap } from "../common/utils/PermissionedSwap.sol";

contract DebtReducer is PermissionedSwap {
  using SafeERC20 for IERC20;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The address of PoolManager contract.
  address public immutable poolManager;

  /***************
   * Constructor *
   ***************/

  constructor(address _poolManager) initializer {
    __Context_init();
    __ERC165_init();
    __AccessControl_init();

    poolManager = _poolManager;

    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @notice Swap base token to target token by amm trading and reduce debt of a pool.
  /// @param pool The address of the pool to reduce debt for.
  /// @param amountIn The amount of input tokens.
  /// @param baseToken The address of base token to use.
  /// @param targetToken The address target token.
  /// @param params The parameters used for trading.
  /// @return amountOut The amount of target token received.
  function swapAndReduceDebt(
    address pool,
    uint256 amountIn,
    address baseToken,
    address targetToken,
    TradingParameter memory params
  ) external returns (uint256 amountOut) {
    // swap base token to target
    amountOut = _doTrade(baseToken, targetToken, amountIn, params);

    // reduce debt
    IERC20(targetToken).forceApprove(poolManager, amountOut);
    IPoolManager(poolManager).reduceDebt(pool, amountOut);
  }
}
