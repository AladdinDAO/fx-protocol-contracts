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

  uint256 private constant MIN_VEST_DURATION = 15 days;

  uint256 private constant MAX_VEST_DURATION = 180 days;

  address public immutable bFXN;

  address public immutable gauge;

  struct Vesting {
    uint256 amount;
    uint256 claimed;
    uint256 penalty;
    uint256 startTimestamp;
    uint256 finishTimestamp;
    bool canceled;
  }

  mapping(address => Vesting[]) private vestings;

  mapping(address => uint256) private activeIndex;

  uint256 public exitPenalty;

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
  }

  function getActiveVestings() external view returns (Vesting[] memory) {
  }

  function stake(uint256 amount) external {
    IERC20(bFXN).safeTransferFrom(_msgSender(), address(this), amount);

    _mint(_msgSender(), amount);
  }

  function exit(uint256 amount) external {
    _burn(_msgSender(), amount);

    uint256 penalty = (amount * SLASHING_RATIO) / PRECISION;
    amount -= penalty;
    exitPenalty += penalty;

    IERC20(bFXN).safeTransfer(_msgSender(), amount);
  }

  function createVest(uint256 amount, uint256 duration) external {}

  function cancelVest(uint256 id) external {}

  function exitVest(uint256 id) external {}

  function distributeExitPenalty() external onlyRole(DISTRIBUTOR_ROLE) {
    uint256 penalty = exitPenalty;
    exitPenalty = 0;
    _mint(address(this), penalty);

    _approve(address(this), gauge, penalty);
    IMultipleRewardDistributor(gauge).depositReward(address(this), penalty);
  }
}
