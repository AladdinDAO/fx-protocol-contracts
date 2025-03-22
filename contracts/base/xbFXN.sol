// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import { IGauge } from "./interfaces/IGauge.sol";
import { IStakedToken } from "./interfaces/IStakedToken.sol";

contract xbFXN is AccessControlUpgradeable, ERC20Upgradeable, IStakedToken {
  using SafeERC20 for IERC20;

  /**********
   * Errors *
   **********/

  error ErrorZeroAmount();

  error ErrorInvalidVestingDuration();

  error ErrorInvalidVestingId();

  error ErrorVestingCannotBeCancelled();

  error ErrorVestingAlreadyCancelled();

  error ErrorVestingNotFinished();

  error ErrorVestingAlreadyClaimed();

  /*************
   * Constants *
   *************/

  /// @notice The role for penalty distributor.
  bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

  /// @dev The precision for penalty computation.
  uint256 private constant PRECISION = 1e9;

  /// @dev The ratio for slashing penalty, multiplied by 1e9.
  uint256 private constant SLASHING_RATIO = 5e8; // 50%

  /// @dev The number of seconds in one day.
  uint256 private constant DAY_SECONDS = 1 days;

  /// @dev The maximum duration can cancel a vesting.
  uint256 private constant MAX_CANCEL_DURATION = 14 days;

  /// @dev The minimum duration for a vesting.
  uint256 private constant MIN_VEST_DURATION = 15 days;

  /// @dev The maximum duration for a vesting.
  uint256 private constant MAX_VEST_DURATION = 180 days;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @dev The address of bFXN token.
  address public immutable bFXN;

  /// @dev The address of xbFXN gauge.
  address public immutable gauge;

  /***********
   * Structs *
   ***********/

  /// @notice The struct for a vesting item.
  /// @dev The compiler will pack it into single `bytes32`.
  /// @param amount The original amount of bFXN to vest.
  /// @param startTimestamp The start timestamp of this vesting.
  /// @param finishTimestamp The finish timestamp of this vesting.
  /// @param cancelled Whether the vesting is cancelled.
  /// @param claimed Whether the vesting is claimed.
  struct Vesting {
    uint112 amount;
    uint64 startTimestamp;
    uint64 finishTimestamp;
    bool cancelled;
    bool claimed;
  }

  /*********************
   * Storage Variables *
   *********************/

  /// @dev Mapping from user address to a list of vestings.
  mapping(address => Vesting[]) private vestings;

  /// @notice Mapping from day timestamp to the amount of penalty to distribute.
  mapping(uint256 => uint256) public exitPenalty;

  /// @notice The next active day timestamp.
  uint256 public nextActiveDay;

  /*************
   * Modifiers *
   *************/

  modifier nonZeroAmount(uint256 amount) {
    if (amount == 0) {
      revert ErrorZeroAmount();
    }
    _;
  }

  /***************
   * Constructor *
   ***************/

  constructor(address _bFXN, address _gauge) {
    bFXN = _bFXN;
    gauge = _gauge;
  }

  function initialize(string memory _name, string memory _symbol) external initializer {
    __Context_init(); // from ContextUpgradeable
    __ERC20_init(_name, _symbol); // from ERC20Upgradeable
    __ERC165_init(); // from ERC165Upgradeable
    __AccessControl_init(); // from AccessControlUpgradeable

    // grant access
    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());

    nextActiveDay = _getDayTimestamp(block.timestamp);
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc IStakedToken
  function getVestingLength(address user) external view returns (uint256) {
    return vestings[user].length;
  }

  /// @notice Return the list of vesting of given user.
  function getUserVestings(address user) external view returns (Vesting[] memory) {
    return vestings[user];
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IStakedToken
  function stake(uint256 amount, address receiver) external nonZeroAmount(amount) {
    IERC20(bFXN).safeTransferFrom(_msgSender(), address(this), amount);

    _mint(receiver, amount);

    emit Stake(_msgSender(), receiver, amount);
  }

  /// @inheritdoc IStakedToken
  function exit(uint256 amount, address receiver) external nonZeroAmount(amount) returns (uint256) {
    _burn(_msgSender(), amount);

    uint256 penalty = (amount * SLASHING_RATIO) / PRECISION;
    uint256 nextDay = _getDayTimestamp(block.timestamp + DAY_SECONDS);
    exitPenalty[nextDay] += penalty;
    amount -= penalty;

    IERC20(bFXN).safeTransfer(receiver, amount);

    emit Exit(_msgSender(), receiver, amount + penalty, penalty);

    return amount;
  }

  /// @inheritdoc IStakedToken
  function createVest(uint112 amount, uint256 duration) external nonZeroAmount(amount) returns (uint256 id) {
    if (duration < MIN_VEST_DURATION || duration > MAX_VEST_DURATION) {
      revert ErrorInvalidVestingDuration();
    }

    address sender = _msgSender();
    _burn(sender, amount);

    uint256 penalty = _getPenalty(amount, duration);
    uint256 cancelDay = _getCancelDayTimestamp(block.timestamp + MAX_CANCEL_DURATION);
    exitPenalty[cancelDay] += penalty;
    id = vestings[sender].length;
    vestings[sender].push(
      Vesting({
        amount: amount,
        startTimestamp: uint64(block.timestamp),
        finishTimestamp: uint64(block.timestamp + duration),
        cancelled: false,
        claimed: false
      })
    );

    emit Vest(sender, id, duration, amount, penalty);
  }

  /// @inheritdoc IStakedToken
  function cancelVest(uint256 id) external {
    address sender = _msgSender();
    if (id >= vestings[sender].length) {
      revert ErrorInvalidVestingId();
    }

    Vesting memory cached = vestings[sender][id];
    if (cached.startTimestamp + MAX_CANCEL_DURATION <= block.timestamp) {
      revert ErrorVestingCannotBeCancelled();
    }
    if (cached.cancelled) {
      revert ErrorVestingAlreadyCancelled();
    }

    _mint(_msgSender(), cached.amount);

    uint256 penalty = _getPenalty(cached.amount, cached.finishTimestamp - cached.startTimestamp);
    uint256 cancelDay = _getCancelDayTimestamp(cached.startTimestamp + MAX_CANCEL_DURATION);
    exitPenalty[cancelDay] -= penalty;
    vestings[sender][id].cancelled = true;

    emit CancelVest(sender, id);
  }

  /// @inheritdoc IStakedToken
  function claimVest(uint256 id) public {
    address sender = _msgSender();
    if (id >= vestings[sender].length) {
      revert ErrorInvalidVestingId();
    }

    Vesting memory cached = vestings[sender][id];
    if (cached.finishTimestamp > block.timestamp) {
      revert ErrorVestingNotFinished();
    }
    if (cached.cancelled) {
      revert ErrorVestingAlreadyCancelled();
    }
    if (cached.claimed) {
      revert ErrorVestingAlreadyClaimed();
    }

    uint256 penalty = _getPenalty(cached.amount, cached.finishTimestamp - cached.startTimestamp);
    vestings[sender][id].claimed = true;

    IERC20(bFXN).safeTransfer(sender, uint256(cached.amount) - penalty);

    emit ClaimVest(sender, id, cached.amount, penalty);
  }

  /// @inheritdoc IStakedToken
  function claimVests(uint256[] memory ids) external {
    for (uint256 i = 0; i < ids.length; ++i) {
      claimVest(ids[i]);
    }
  }

  /// @inheritdoc IStakedToken
  function distributeExitPenalty() external onlyRole(DISTRIBUTOR_ROLE) {
    uint256 nowDay = _getDayTimestamp(block.timestamp);
    uint256 day = nextActiveDay;
    uint256 penalty;
    while (day <= nowDay) {
      uint256 dayPenalty = exitPenalty[day];
      if (dayPenalty > 0) {
        emit DistributeExitPenalty(day, dayPenalty);
      }

      penalty += dayPenalty;
      day += DAY_SECONDS;
    }
    nextActiveDay = day;

    if (penalty > 0) {
      _mint(address(this), penalty);
      _approve(address(this), gauge, penalty);
      IGauge(gauge).depositReward(address(this), penalty);
    }
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to get the day timestamp for cancel (i.e. `ceil(timestamp / 86400) * 86400`).
  function _getCancelDayTimestamp(uint256 timestamp) internal pure returns (uint256) {
    return ((timestamp + DAY_SECONDS - 1) / DAY_SECONDS) * DAY_SECONDS;
  }

  /// @dev Internal function to get the day timestamp (i.e. `floor(timestamp / 86400) * 86400`).
  function _getDayTimestamp(uint256 timestamp) internal pure returns (uint256) {
    return (timestamp / DAY_SECONDS) * DAY_SECONDS;
  }

  /// @dev Internal function to get penalty given `amount` and vesting `duration`.
  function _getPenalty(uint256 amount, uint256 duration) internal pure returns (uint256) {
    // (duration - MIN_VEST_DURATION) / (MAX_VEST_DURATION - MIN_VEST_DURATION) = (r - 0.5) / 0.5
    // r = 0.5 * (duration - MIN_VEST_DURATION) / (MAX_VEST_DURATION - MIN_VEST_DURATION) + 0.5
    // p = amount * (1 - r)
    uint256 p = (PRECISION - ((duration - MIN_VEST_DURATION) * PRECISION) / (MAX_VEST_DURATION - MIN_VEST_DURATION)) /
      2;
    return (p * amount) / PRECISION;
  }
}
