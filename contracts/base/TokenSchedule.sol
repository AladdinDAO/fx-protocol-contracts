// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import { IMultipleRewardDistributor } from "../common/rewards/distributor/IMultipleRewardDistributor.sol";
import { ITokenMinter } from "./interfaces/ITokenMinter.sol";
import { ITokenSchedule } from "./interfaces/ITokenSchedule.sol";

contract TokenSchedule is AccessControlUpgradeable, ITokenSchedule {
  using SafeERC20 for IERC20;
  using EnumerableSet for EnumerableSet.AddressSet;

  bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

  uint256 private constant PRECISION = 1e18;

  address public immutable minter;

  address public immutable token;

  EnumerableSet.AddressSet private gauges;

  mapping(address => uint256) private weight;

  uint256 public totalWeight;

  uint256 public lastTime;

  constructor(address _minter) {
    minter = _minter;
    token = ITokenMinter(_minter).token();
  }

  function initialize() external initializer {
    __Context_init(); // from ContextUpgradeable
    __ERC165_init(); // from ERC165Upgradeable
    __AccessControl_init(); // from AccessControlUpgradeable

    lastTime = ITokenMinter(minter).getStartEpochTime();
  }

  function getGauges() external view returns (address[] memory res) {
    uint256 length = gauges.length();
    res = new address[](length);
    for (uint256 i = 0; i < length; ++i) {
      res[i] = gauges.at(i);
    }
  }

  function getWeight(address gauge) external view returns (uint256) {
    return weight[gauge];
  }

  function getNormalizedWeight(address gauge) external view returns (uint256) {
    if (totalWeight == 0) return 0;
    return (weight[gauge] * PRECISION) / totalWeight;
  }

  function distribute() external onlyRole(DISTRIBUTOR_ROLE) {
    uint256 minted = ITokenMinter(minter).mintableInTimeframe(lastTime, block.timestamp);
    if (minted == 0) revert();
    ITokenMinter(minter).mint(address(this), minted);
    lastTime = block.timestamp;

    uint256 length = gauges.length();
    uint256 cachedTotalWeight = totalWeight;
    for (uint256 i = 0; i < length; ++i) {
      address gauge = gauges.at(i);
      uint256 amount = (weight[gauge] * minted) / cachedTotalWeight;
      IERC20(token).forceApprove(gauge, amount);
      IMultipleRewardDistributor(gauge).depositReward(token, amount);
    }
  }

  function updateGaugeWeight(address gauge, uint256 newWeight) external onlyRole(DEFAULT_ADMIN_ROLE) {
    uint256 oldWeight = weight[gauge];
    if (oldWeight == newWeight) revert();

    if (oldWeight == 0) gauges.add(gauge);
    if (newWeight == 0) gauges.remove(gauge);
    weight[gauge] = newWeight;
    totalWeight = totalWeight - oldWeight + newWeight;
  }
}
