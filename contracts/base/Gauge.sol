// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import { IGauge } from "./interfaces/IGauge.sol";
import { IStakedToken } from "./interfaces/IStakedToken.sol";

import { MultipleRewardAccumulator } from "../common/rewards/accumulator/MultipleRewardAccumulator.sol";
import { LinearMultipleRewardDistributor } from "../common/rewards/distributor/LinearMultipleRewardDistributor.sol";

// solhint-disable func-name-mixedcase
// solhint-disable not-rely-on-time

/// @title Gauge
contract Gauge is ERC20PermitUpgradeable, MultipleRewardAccumulator, IGauge {
  using SafeERC20 for IERC20;

  /**********
   * Errors *
   **********/

  /// @dev Thrown when someone deposit zero amount staking token.
  error DepositZeroAmount();

  /// @dev Thrown when someone withdraw zero amount staking token.
  error WithdrawZeroAmount();

  /*************
   * Constants *
   *************/

  /// @dev The number of seconds in one week.
  uint256 internal constant WEEK = 7 days;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The address of bFXN token.
  address public immutable bFXN;

  /// @notice The address of xbFXN contract.
  address public immutable xbFXN;

  /*********************
   * Storage Variables *
   *********************/

  /// @inheritdoc IGauge
  address public stakingToken;

  /// @notice Mapping from user address to the user governance token reward snapshot.
  ///
  /// @dev The integral is the value of `snapshot.integral` when the snapshot is taken.
  mapping(address => UserRewardSnapshot) public userSnapshot;

  /// @dev reserved slots.
  uint256[48] private __gap;

  /***************
   * Constructor *
   ***************/

  constructor(address _bFXN, address _xbFXN) LinearMultipleRewardDistributor(uint40(WEEK)) {
    bFXN = _bFXN;
    xbFXN = _xbFXN;
  }

  /// @notice Initialize the state of Gauge.
  ///
  /// @dev The caller should make sure the decimal of `_stakingToken` is `18`.
  ///
  /// @param _stakingToken The address of staking token.
  function initialize(address _stakingToken) external initializer {
    string memory _name = string(abi.encodePacked(ERC20PermitUpgradeable(_stakingToken).name(), " Gauge"));
    string memory _symbol = string(abi.encodePacked(ERC20PermitUpgradeable(_stakingToken).symbol(), "-gauge"));

    __Context_init(); // from ContextUpgradeable
    __ERC20_init(_name, _symbol); // from ERC20Upgradeable
    __ERC20Permit_init(_name); // from ERC20PermitUpgradeable
    __ReentrancyGuard_init(); // from ReentrancyGuardUpgradeable
    __ERC165_init(); // from ERC165Upgradeable
    __AccessControl_init(); // from AccessControlUpgradeable

    __LinearMultipleRewardDistributor_init(); // from LinearMultipleRewardDistributor
    __MultipleRewardAccumulator_init(); // from MultipleRewardAccumulator

    // grant access
    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());

    // initialize variables
    stakingToken = _stakingToken;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IGauge
  function deposit(uint256 _amount) external nonReentrant {
    address _sender = _msgSender();
    _deposit(_sender, _amount, _sender);
  }

  /// @inheritdoc IGauge
  function deposit(uint256 _amount, address _receiver) external nonReentrant {
    _deposit(_msgSender(), _amount, _receiver);
  }

  /// @inheritdoc IGauge
  function withdraw(uint256 _amount) external nonReentrant {
    address _sender = _msgSender();
    _withdraw(_sender, _amount, _sender);
  }

  /// @inheritdoc IGauge
  function withdraw(uint256 _amount, address _receiver) external nonReentrant {
    _withdraw(_msgSender(), _amount, _receiver);
  }

  /// @inheritdoc IGauge
  function claimAndExit(address _receiver) external nonReentrant {
    _checkpoint(_msgSender());

    address _receiverStored = rewardReceiver[_msgSender()];
    if (_receiverStored != address(0) && _receiver == address(0)) {
      _receiver = _receiverStored;
    }
    if (_receiver == address(0)) _receiver = _msgSender();

    address[] memory _activeRewardTokens = getActiveRewardTokens();
    for (uint256 i = 0; i < _activeRewardTokens.length; i++) {
      _claimSingleWithExit(_msgSender(), _activeRewardTokens[i], _receiver, true);
    }
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @inheritdoc ERC20Upgradeable
  function _update(address from, address to, uint256 value) internal virtual override {
    if (from != address(0) && to != address(0)) {
      // check reentrancy on transfer or transferFrom
      require(!_reentrancyGuardEntered(), "ReentrancyGuard: reentrant call");

      _checkpoint(from);
      _checkpoint(to);
    }

    super._update(from, to, value);
  }

  /// @inheritdoc MultipleRewardAccumulator
  function _getTotalPoolShare() internal view virtual override returns (uint256) {
    return totalSupply();
  }

  /// @inheritdoc MultipleRewardAccumulator
  function _getUserPoolShare(address _account) internal view virtual override returns (uint256) {
    return balanceOf(_account);
  }

  /// @inheritdoc MultipleRewardAccumulator
  function _claimSingle(
    address _account,
    address _token,
    address _receiver
  ) internal virtual override returns (uint256) {
    return _claimSingleWithExit(_account, _token, _receiver, false);
  }

  /// @dev Internal function to claim single reward token with `_exit` flag.
  /// Caller should make sure `_checkpoint` is called before this function.
  ///
  /// @param _account The address of user to claim.
  /// @param _token The address of reward token.
  /// @param _receiver The address of recipient of the reward token.
  /// @param _exit Whether to exit from xbFXN.
  function _claimSingleWithExit(
    address _account,
    address _token,
    address _receiver,
    bool _exit
  ) internal virtual returns (uint256) {
    if (_token != bFXN) {
      return MultipleRewardAccumulator._claimSingle(_account, _token, _receiver);
    }

    ClaimData memory _rewards = userRewardSnapshot[_account][_token].rewards;
    uint256 _amount = _rewards.pending;
    if (_amount > 0) {
      _rewards.claimed += _rewards.pending;
      _rewards.pending = 0;
      userRewardSnapshot[_account][_token].rewards = _rewards;

      IERC20(bFXN).forceApprove(xbFXN, _amount);
      if (_exit) {
        IStakedToken(xbFXN).stake(_amount, address(this));
        _amount = IStakedToken(xbFXN).exit(_amount, _receiver);
        emit Claim(_account, bFXN, _receiver, _amount);
      } else {
        IStakedToken(xbFXN).stake(_amount, _receiver);
        emit Claim(_account, xbFXN, _receiver, _amount);
      }
    }
    return _amount;
  }

  /// @dev Internal function to deposit staking token.
  /// @param _owner The address of staking token owner.
  /// @param _amount The amount of staking token to deposit.
  /// @param _receiver The address of pool share recipient.
  function _deposit(address _owner, uint256 _amount, address _receiver) internal nonReentrant {
    // transfer token
    _amount = _transferStakingTokenIn(_owner, _amount);

    // checkpoint
    _checkpoint(_receiver);

    // mint pool share
    _mint(_receiver, _amount);

    // emit event
    emit Deposit(_owner, _receiver, _amount);
  }

  /// @dev Internal function to withdraw staking token.
  /// @param _owner The address of pool share owner.
  /// @param _amount The amount of staking token to withdraw.
  /// @param _receiver The address of staking token recipient.
  function _withdraw(address _owner, uint256 _amount, address _receiver) internal nonReentrant {
    // do checkpoint
    _checkpoint(_owner);

    // burn user share
    if (_amount == type(uint256).max) {
      _amount = balanceOf(_owner);
    }
    if (_amount == 0) revert WithdrawZeroAmount();
    _burn(_owner, _amount);

    // transfer token out
    _transferStakingTokenOut(_receiver, _amount);

    // emit event
    emit Withdraw(_owner, _receiver, _amount);
  }

  /// @dev Internal function to transfer staking token to this contract.
  /// @param _owner The address of the token owner.
  /// @param _amount The amount of token to transfer.
  function _transferStakingTokenIn(address _owner, uint256 _amount) internal virtual returns (uint256) {
    // transfer token to this contract
    address _stakingToken = stakingToken;
    if (_amount == type(uint256).max) {
      _amount = IERC20(_stakingToken).balanceOf(_owner);
    }
    if (_amount == 0) revert DepositZeroAmount();

    IERC20(_stakingToken).safeTransferFrom(_owner, address(this), _amount);

    return _amount;
  }

  /// @dev Internal function to transfer staking token to some user.
  /// @param _receiver The address of the token recipient.
  /// @param _amount The amount of token to transfer.
  function _transferStakingTokenOut(address _receiver, uint256 _amount) internal virtual {
    if (_amount > 0) {
      IERC20(stakingToken).safeTransfer(_receiver, _amount);
    }
  }
}
