// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IAaveRewardsController } from "../../interfaces/Aave/IAaveRewardsController.sol";
import { IAaveV3Pool } from "../../interfaces/Aave/IAaveV3Pool.sol";

import { StrategyBase } from "./StrategyBase.sol";

/// @title AaveV3CompoundStrategy
/// @notice A strategy for Aave V3.
/// @dev This strategy is used for compound interest.
contract AaveV3CompoundStrategy is StrategyBase {
  using SafeERC20 for IERC20;

  error ErrorHarvestNotAllowed();

  address public immutable POOL;

  address public immutable ASSET;

  address public immutable ATOKEN;

  constructor(
    address _admin,
    address _operator,
    address _pool,
    address _asset,
    address _atoken
  ) StrategyBase(_admin, _operator) {
    POOL = _pool;
    ASSET = _asset;
    ATOKEN = _atoken;

    IERC20(ASSET).forceApprove(POOL, type(uint256).max);
  }

  function totalSupply() public view returns (uint256) {
    return IERC20(ATOKEN).balanceOf(address(this));
  }

  function deposit(uint256 amount) external onlyOperator {
    IAaveV3Pool(POOL).supply(ASSET, amount, address(this), 0);
  }

  function withdraw(uint256 amount, address recipient) external onlyOperator {
    uint256 cachedSupply = totalSupply();
    if (amount > cachedSupply) amount = cachedSupply;
    IAaveV3Pool(POOL).withdraw(ASSET, amount, recipient);
  }

  function kill() external onlyOperator {
    if (totalSupply() > 0) {
      IAaveV3Pool(POOL).withdraw(ASSET, type(uint256).max, operator);
    }
  }

  function _harvest(address) internal virtual override {
    revert ErrorHarvestNotAllowed();
  }
}
