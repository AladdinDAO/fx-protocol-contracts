// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAerodromePool } from "../interfaces/Aerodrome/IAerodromePool.sol";

import { PegKeeper } from "../core/PegKeeper.sol";

contract BasePegKeeper is PegKeeper {
  using SafeERC20 for IERC20;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The scale of stable token to 18 decimals.
  uint256 public immutable stableScale;

  /***************
   * Constructor *
   ***************/

  constructor(address _fxBASE) PegKeeper(_fxBASE) {
    stableScale = 10 ** (18 - IERC20Metadata(stable).decimals());
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @inheritdoc PegKeeper
  function _doSwap(
    address srcToken,
    uint256 amountIn,
    bytes calldata data
  ) internal override returns (uint256 amountOut) {
    IERC20(srcToken).forceApprove(converter, amountIn);

    (uint256 minOut, address dstToken, bytes memory swapData) = abi.decode(data, (uint256, address, bytes));
    uint256 balanceBefore = IERC20(dstToken).balanceOf(address(this));
    (bool success, ) = converter.call(swapData);
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
    amountOut = IERC20(dstToken).balanceOf(address(this)) - balanceBefore;
    if (amountOut < minOut) revert ErrorInsufficientOutput();
  }

  /// @inheritdoc PegKeeper
  function _getFxUSDEmaPrice() internal view override returns (uint256 price) {
    if (curvePool == address(0)) return PRECISION;

    return IAerodromePool(curvePool).quote(fxUSD, 1e18, 1) * stableScale;
  }
}
