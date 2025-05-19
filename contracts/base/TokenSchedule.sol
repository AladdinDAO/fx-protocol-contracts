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

  /**********
   * Errors *
   **********/

  error ErrorNoTokenToDistribute();

  error ErrorGaugeWeightNotChanged();

  /*************
   * Constants *
   *************/

  /// @notice The role for token distributor.
  bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

  /// @dev The precision for normalized gauge weight.
  uint256 private constant PRECISION = 1e18;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The address of token minter.
  address public immutable minter;

  /// @notice The address of token.
  address public immutable token;

  /*********************
   * Storage Variables *
   *********************/

  /// @dev The list of non-zero weight gauges.
  EnumerableSet.AddressSet private gauges;

  /// @dev Mapping from gauge address to gauge weight.
  mapping(address => uint256) private weight;

  /// @inheritdoc ITokenSchedule
  uint256 public totalWeight;

  /// @notice The timestamp for last `distribute()` function call.
  uint256 public lastDistributeTime;

  /***************
   * Constructor *
   ***************/

  constructor(address _minter) {
    minter = _minter;
    token = ITokenMinter(_minter).token();
  }

  function initialize() external initializer {
    __Context_init(); // from ContextUpgradeable
    __ERC165_init(); // from ERC165Upgradeable
    __AccessControl_init(); // from AccessControlUpgradeable

    lastDistributeTime = ITokenMinter(minter).getStartEpochTime();

    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc ITokenSchedule
  function getGauges() external view returns (address[] memory res) {
    uint256 length = gauges.length();
    res = new address[](length);
    for (uint256 i = 0; i < length; ++i) {
      res[i] = gauges.at(i);
    }
  }

  /// @inheritdoc ITokenSchedule
  function getWeight(address gauge) external view returns (uint256) {
    return weight[gauge];
  }

  /// @inheritdoc ITokenSchedule
  function getNormalizedWeight(address gauge) external view returns (uint256) {
    if (totalWeight == 0) return 0;
    return (weight[gauge] * PRECISION) / totalWeight;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc ITokenSchedule
  function distribute() external onlyRole(DISTRIBUTOR_ROLE) {
    uint256 minted = ITokenMinter(minter).mintableInTimeframe(lastDistributeTime, block.timestamp);
    if (minted == 0) revert ErrorNoTokenToDistribute();
    ITokenMinter(minter).mint(address(this), minted);
    lastDistributeTime = block.timestamp;

    uint256 length = gauges.length();
    uint256 cachedTotalWeight = totalWeight;
    for (uint256 i = 0; i < length; ++i) {
      address gauge = gauges.at(i);
      uint256 amount = (weight[gauge] * minted) / cachedTotalWeight;
      IERC20(token).forceApprove(gauge, amount);
      IMultipleRewardDistributor(gauge).depositReward(token, amount);

      emit DistributeRewards(gauge, amount);
    }
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Update the gauge weight.
  /// @param gauge The address of gauge to update.
  /// @param newWeight The new gauge weight.
  function updateGaugeWeight(address gauge, uint256 newWeight) external onlyRole(DEFAULT_ADMIN_ROLE) {
    uint256 oldWeight = weight[gauge];
    if (oldWeight == newWeight) revert ErrorGaugeWeightNotChanged();

    if (oldWeight == 0) gauges.add(gauge);
    if (newWeight == 0) gauges.remove(gauge);
    weight[gauge] = newWeight;
    totalWeight = totalWeight - oldWeight + newWeight;

    emit UpdateGaugeWeight(gauge, oldWeight, newWeight);
  }
}
