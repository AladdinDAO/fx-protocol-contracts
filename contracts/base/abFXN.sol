// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ERC4626Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";

import { ConcentratorBase } from "../common/concentrator/ConcentratorBase.sol";
import { LinearRewardDistributor } from "../common/rewards/distributor/LinearRewardDistributor.sol";

import { IHarvesterCallback } from "../helpers/interfaces/IHarvesterCallback.sol";
import { IGauge } from "./interfaces/IGauge.sol";
import { IStakedToken } from "./interfaces/IStakedToken.sol";

/// @title abFXN
/// @notice A vault that allows users to deposit and withdraw bFXN.
/// @dev This contract will never hold any xbFXN, all xbFXN will be deposited to the gauge right after transferred from user,
///      harvested from harvester and deposited by rewards distributor.
contract abFXN is ERC4626Upgradeable, ConcentratorBase, LinearRewardDistributor {
  using SafeERC20 for IERC20;

  /**********
   * Errors *
   **********/

  error ErrorInvalidToken();

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The address of bFXN token.
  address public immutable bFXN;

  /// @notice The address of xbFXN token.
  address public immutable xbFXN;

  /// @notice The address of gauge for xbFXN.
  address public immutable gauge;

  /*************
   * Variables *
   *************/

  /// @dev The total amount of underlying token tracked.
  uint256 private totalUnderlying;

  /*************
   * Modifiers *
   *************/

  modifier sync() {
    IGauge(gauge).checkpoint(address(this));
    _distributePendingReward();
    _;
  }

  /***************
   * Constructor *
   ***************/

  constructor(address _bFXN, address _gauge) LinearRewardDistributor(1 weeks) {
    bFXN = _bFXN;
    xbFXN = IGauge(_gauge).stakingToken();
    gauge = _gauge;
  }

  function initialize(
    string memory _name,
    string memory _symbol,
    address _treasury,
    address _harvester
  ) external initializer {
    __Context_init(); // from ContextUpgradeable
    __ERC165_init(); // from ERC165Upgradeable
    __AccessControl_init(); // from AccessControlUpgradeable
    __ERC20_init(_name, _symbol); // from ERC20Upgradeable
    __ERC4626_init(IERC20(xbFXN)); // from ERC4626Upgradeable

    __ConcentratorBase_init(_treasury, _harvester); // from ConcentratorBase

    __LinearRewardDistributor_init(xbFXN); // from LinearRewardDistributor

    IERC20(bFXN).forceApprove(xbFXN, type(uint256).max);
    IERC20(xbFXN).forceApprove(gauge, type(uint256).max);

    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc ERC4626Upgradeable
  function totalAssets() public view virtual override returns (uint256) {
    (uint256 realized, ) = pendingRewards();
    return realized + totalUnderlying;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc ERC4626Upgradeable
  function deposit(uint256 assets, address receiver) public virtual override sync returns (uint256) {
    return super.deposit(assets, receiver);
  }

  /// @inheritdoc ERC4626Upgradeable
  function mint(uint256 shares, address receiver) public virtual override sync returns (uint256) {
    return super.mint(shares, receiver);
  }

  /// @inheritdoc ERC4626Upgradeable
  function withdraw(uint256 assets, address receiver, address owner) public virtual override sync returns (uint256) {
    return super.withdraw(assets, receiver, owner);
  }

  /// @inheritdoc ERC4626Upgradeable
  function redeem(uint256 shares, address receiver, address owner) public virtual override sync returns (uint256) {
    return super.redeem(shares, receiver, owner);
  }

  /// @notice Harvest pending rewards.
  function harvest() external sync {
    // claim all pending rewards and later will be transferred to harvester
    IGauge(gauge).claim();

    // handle rewards, assuming no historical rewards
    address[] memory tokens = IGauge(gauge).getActiveRewardTokens();
    address cachedHarvester = harvester;
    uint256 harvesterRatio = getHarvesterRatio();
    uint256 expenseRatio = getExpenseRatio();
    for (uint256 i = 0; i < tokens.length; ++i) {
      _transferRewards(tokens[i], cachedHarvester, harvesterRatio, expenseRatio);
    }
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @inheritdoc LinearRewardDistributor
  function _accumulateReward(uint256 _amount) internal virtual override {
    totalUnderlying += _amount;
  }

  /// @inheritdoc LinearRewardDistributor
  /// @dev All deposited xbFXN will be deposited to the gauge.
  function _afterRewardDeposit(uint256 _amount) internal virtual override {
    IGauge(gauge).deposit(_amount);
  }

  /// @inheritdoc ConcentratorBase
  function _onHarvest(address token, uint256 amount) internal virtual override {
    if (token == bFXN) {
      IStakedToken(xbFXN).stake(amount, address(this));
    } else if (token != xbFXN) {
      revert ErrorInvalidToken();
    }

    _distributePendingReward();

    _notifyReward(amount);

    _afterRewardDeposit(amount);

    emit DepositReward(amount);
  }

  /// @inheritdoc ERC4626Upgradeable
  function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual override {
    super._deposit(caller, receiver, assets, shares);

    IGauge(gauge).deposit(assets);
    totalUnderlying += assets;
  }

  /// @inheritdoc ERC4626Upgradeable
  function _withdraw(
    address caller,
    address receiver,
    address owner,
    uint256 assets,
    uint256 shares
  ) internal virtual override {
    IGauge(gauge).withdraw(assets);

    super._withdraw(caller, receiver, owner, assets, shares);
    totalUnderlying -= assets;
  }

  /// @dev Internal function to transfer rewards to harvester.
  /// @param token The address of rewards.
  /// @param receiver The address of harvester.
  function _transferRewards(address token, address receiver, uint256 harvesterRatio, uint256 expenseRatio) internal {
    uint256 balance = IERC20(token).balanceOf(address(this));
    if (balance > 0) {
      uint256 performanceFee = (balance * expenseRatio) / FEE_PRECISION;
      uint256 harvesterBounty = (balance * harvesterRatio) / FEE_PRECISION;
      if (harvesterBounty > 0) {
        IERC20(token).safeTransfer(_msgSender(), harvesterBounty);
      }
      if (performanceFee > 0) {
        IERC20(token).safeTransfer(treasury, performanceFee);
      }
      IERC20(token).safeTransfer(receiver, balance - performanceFee - harvesterBounty);
    }
  }
}
