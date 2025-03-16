// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import { IMultipleRewardDistributor } from "../common/rewards/distributor/IMultipleRewardDistributor.sol";

contract xbFXN is AccessControlUpgradeable, ERC20Upgradeable {
  using SafeERC20 for IERC20;

  bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

  uint256 private constant PRECISION = 1e9;

  uint256 private constant SLASHING_RATIO = 5e8; // 50%

  uint256 private constant DAY_SECONDS = 1 days;

  uint256 private constant MAX_CANCEL_DURATION = 14 days;

  uint256 private constant MIN_VEST_DURATION = 15 days;

  uint256 private constant MAX_VEST_DURATION = 180 days;

  address public immutable bFXN;

  address public immutable gauge;

  struct Vesting {
    uint112 amount;
    uint64 startTimestamp;
    uint64 finishTimestamp;
    bool canceled;
    bool claimed;
  }

  mapping(address => Vesting[]) private vestings;

  mapping(uint256 => uint256) public exitPenalty;

  uint256 public nextActiveDay;

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

  function getVestingLength(address user) external view returns (uint256) {
    return vestings[user].length;
  }

  function getUserVestings(address user) external view returns (Vesting[] memory) {
    return vestings[user];
  }

  function stake(uint256 amount) external {
    IERC20(bFXN).safeTransferFrom(_msgSender(), address(this), amount);

    _mint(_msgSender(), amount);
  }

  function exit(uint256 amount) external {
    _burn(_msgSender(), amount);

    uint256 penalty = (amount * SLASHING_RATIO) / PRECISION;
    uint256 nextDay = _getDayTimestamp(block.timestamp + DAY_SECONDS);
    exitPenalty[nextDay] += penalty;
    amount -= penalty;

    IERC20(bFXN).safeTransfer(_msgSender(), amount);
  }

  function createVest(uint112 amount, uint256 duration) external {
    if (duration < MIN_VEST_DURATION || duration > MAX_VEST_DURATION) revert();

    address sender = _msgSender();
    _burn(sender, amount);

    uint256 penalty = _getPenalty(amount, duration);
    uint256 cancelDay = _getCancelDayTimestamp(block.timestamp + MAX_CANCEL_DURATION);
    exitPenalty[cancelDay] += penalty;
    vestings[sender].push(
      Vesting({
        amount: amount,
        startTimestamp: uint64(block.timestamp),
        finishTimestamp: uint64(block.timestamp + duration),
        canceled: false,
        claimed: false
      })
    );
  }

  function cancelVest(uint256 id) external {
    address sender = _msgSender();
    if (id >= vestings[sender].length) revert();

    Vesting memory cached = vestings[sender][id];
    if (cached.startTimestamp + MAX_CANCEL_DURATION <= block.timestamp) revert();
    if (cached.canceled) revert();

    _mint(_msgSender(), cached.amount);

    uint256 penalty = _getPenalty(cached.amount, cached.finishTimestamp - cached.startTimestamp);
    uint256 cancelDay = _getCancelDayTimestamp(cached.startTimestamp + MAX_CANCEL_DURATION);
    exitPenalty[cancelDay] -= penalty;
    vestings[sender][id].canceled = true;
  }

  function claimVest(uint256 id) public {
    address sender = _msgSender();
    if (id >= vestings[sender].length) revert();

    Vesting memory cached = vestings[sender][id];
    if (cached.finishTimestamp > block.timestamp) revert();
    if (cached.canceled) revert();
    if (cached.claimed) revert();

    uint256 penalty = _getPenalty(cached.amount, cached.finishTimestamp - cached.startTimestamp);
    vestings[sender][id].claimed = true;

    IERC20(bFXN).safeTransfer(sender, uint256(cached.amount) - penalty);
  }

  function claimVests(uint256[] memory ids) external {
    for (uint256 i = 0; i < ids.length; ++i) {
      claimVest(ids[i]);
    }
  }

  function distributeExitPenalty() external onlyRole(DISTRIBUTOR_ROLE) {
    uint256 nowDay = _getDayTimestamp(block.timestamp);
    uint256 day = nextActiveDay;
    uint256 penalty;
    while (day <= nowDay) {
      penalty += exitPenalty[day];
      day += DAY_SECONDS;
    }
    nextActiveDay = day;

    if (penalty > 0) {
      _mint(address(this), penalty);
      _approve(address(this), gauge, penalty);
      IMultipleRewardDistributor(gauge).depositReward(address(this), penalty);
    }
  }

  function _getCancelDayTimestamp(uint256 timestamp) internal pure returns (uint256) {
    return ((timestamp + DAY_SECONDS - 1) / DAY_SECONDS) * DAY_SECONDS;
  }

  function _getDayTimestamp(uint256 timestamp) internal pure returns (uint256) {
    return (timestamp / DAY_SECONDS) * DAY_SECONDS;
  }

  function _getPenalty(uint256 amount, uint256 duration) internal pure returns (uint256) {
    // (duration - MIN_VEST_DURATION) / (MAX_VEST_DURATION - MIN_VEST_DURATION) = (r - 0.5) / 0.5
    // r = 0.5 * (duration - MIN_VEST_DURATION) / (MAX_VEST_DURATION - MIN_VEST_DURATION) + 0.5
    // p = amount * (1 - r)
    uint256 p = (PRECISION - ((duration - MIN_VEST_DURATION) * PRECISION) / (MAX_VEST_DURATION - MIN_VEST_DURATION)) /
      2;
    return (p * amount) / PRECISION;
  }
}
