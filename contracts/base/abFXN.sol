// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC4626Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";

import { IMultipleRewardAccumulator } from "../common/rewards/accumulator/IMultipleRewardAccumulator.sol";
import { IGauge } from "./interfaces/IGauge.sol";

contract abFXN is ERC4626Upgradeable {
  using SafeERC20 for IERC20;

  address public immutable xbFXN;

  address public immutable gauge;

  constructor(address _xbFXN, address _gauge) {
    xbFXN = _xbFXN;
    gauge = _gauge;
  }

  function initialize(string memory _name, string memory _symbol) external initializer {
    __Context_init();

    __ERC20_init(_name, _symbol);
    __ERC4626_init(IERC20(xbFXN));

    IERC20(xbFXN).forceApprove(gauge, type(uint256).max);
  }

  /// @inheritdoc ERC4626Upgradeable
  function totalAssets() public view virtual override returns (uint256) {
    return IERC20(gauge).balanceOf(address(this));
  }

  function harvest() external {
    IMultipleRewardAccumulator(gauge).claim();
    uint256 balance = IERC20(xbFXN).balanceOf(address(this));
    IGauge(gauge).deposit(balance);
  }

  function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual override {
    super._deposit(caller, receiver, assets, shares);

    IGauge(gauge).deposit(assets);
  }

  function _withdraw(
    address caller,
    address receiver,
    address owner,
    uint256 assets,
    uint256 shares
  ) internal virtual override {
    IGauge(gauge).withdraw(assets);

    super._withdraw(caller, receiver, owner, assets, shares);
  }
}
