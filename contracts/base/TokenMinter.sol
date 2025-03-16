// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import { IGovernanceToken } from "./interfaces/IGovernanceToken.sol";
import { ITokenMinter } from "./interfaces/ITokenMinter.sol";

contract TokenMinter is AccessControlUpgradeable, ITokenMinter {
  bytes32 constant MINTER_ROLE = keccak256("MINTER_ROLE");

  uint256 private constant RATE_REDUCTION_TIME = 365 days;
  uint256 private constant RATE_REDUCTION_COEFFICIENT = 1189207115002721024; // 2 ** (1/4) * 1e18
  uint256 private constant RATE_DENOMINATOR = 1e18;

  address public immutable token;

  event MiningParametersUpdated(uint256 rate, uint256 supply);

  // Supply Variables
  uint256 private _miningEpoch;
  uint256 private _startEpochTime;
  uint256 private _startEpochSupply;
  uint256 private _rate;

  constructor(address _token) {
    token = _token;
  }

  function initialize(uint256 _initSupply, uint256 _initRate) external initializer {
    __Context_init(); // from ContextUpgradeable
    __ERC165_init(); // from ERC165Upgradeable
    __AccessControl_init(); // from AccessControlUpgradeable

    _startEpochSupply = _initSupply;
    _startEpochTime = block.timestamp;
    _rate = _initRate;

    emit MiningParametersUpdated(_initRate, _initSupply);
  }

  /// @notice Returns the current epoch number.
  function getMiningEpoch() external view returns (uint256) {
    return _miningEpoch;
  }

  /// @notice Returns the start timestamp of the current epoch.
  function getStartEpochTime() external view returns (uint256) {
    return _startEpochTime;
  }

  /// @notice Returns the start timestamp of the next epoch.
  function getFutureEpochTime() external view returns (uint256) {
    return _startEpochTime + RATE_REDUCTION_TIME;
  }

  /// @notice Returns the available supply at the beginning of the current epoch.
  function getStartEpochSupply() external view returns (uint256) {
    return _startEpochSupply;
  }

  /// @notice Returns the current inflation rate of BAL per second
  function getInflationRate() external view returns (uint256) {
    return _rate;
  }

  /// @notice Maximum allowable number of tokens in existence (claimed or unclaimed)
  function getAvailableSupply() external view returns (uint256) {
    return _availableSupply();
  }

  function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
    // Check if we've passed into a new epoch such that we should calculate available supply with a smaller rate.
    if (block.timestamp >= _startEpochTime + RATE_REDUCTION_TIME) {
      _updateMiningParameters();
    }

    if (IGovernanceToken(token).totalSupply() + amount > _availableSupply()) revert();

    IGovernanceToken(token).mint(to, amount);
  }

  /// @notice Get timestamp of the current mining epoch start while simultaneously updating mining parameters
  /// @return Timestamp of the current epoch
  function startEpochTimeWrite() external returns (uint256) {
    return _startEpochTimeWrite();
  }

  /// @notice Get timestamp of the next mining epoch start while simultaneously updating mining parameters
  /// @return Timestamp of the next epoch
  function futureEpochTimeWrite() external returns (uint256) {
    return _startEpochTimeWrite() + RATE_REDUCTION_TIME;
  }

  /// @notice Update mining rate and supply at the start of the epoch
  /// @dev Callable by any address, but only once per epoch
  /// Total supply becomes slightly larger if this function is called late
  function updateMiningParameters() external {
    if (block.timestamp < _startEpochTime + RATE_DENOMINATOR) revert();
    _updateMiningParameters();
  }

  /// @notice How much supply is mintable from start timestamp till end timestamp
  /// @param start Start of the time interval (timestamp)
  /// @param end End of the time interval (timestamp)
  /// @return Tokens mintable from `start` till `end`
  function mintableInTimeframe(uint256 start, uint256 end) external view returns (uint256) {
    return _mintableInTimeframe(start, end);
  }

  // Internal functions

  /// @dev Maximum allowable number of tokens in existence (claimed or unclaimed)
  function _availableSupply() internal view returns (uint256) {
    uint256 newSupplyFromCurrentEpoch = (block.timestamp - _startEpochTime) * _rate;
    return _startEpochSupply + newSupplyFromCurrentEpoch;
  }

  /// @dev Get timestamp of the current mining epoch start while simultaneously updating mining parameters
  /// @return Timestamp of the current epoch
  function _startEpochTimeWrite() internal returns (uint256) {
    uint256 startEpochTime = _startEpochTime;
    if (block.timestamp >= startEpochTime + RATE_REDUCTION_TIME) {
      _updateMiningParameters();
      return _startEpochTime;
    }
    return startEpochTime;
  }

  function _updateMiningParameters() internal {
    uint256 inflationRate = _rate;
    uint256 startEpochSupply = _startEpochSupply + inflationRate * RATE_REDUCTION_TIME;
    inflationRate = (inflationRate * RATE_DENOMINATOR) / RATE_REDUCTION_COEFFICIENT;

    _miningEpoch += 1;
    _startEpochTime += RATE_REDUCTION_TIME;
    _rate = inflationRate;
    _startEpochSupply = startEpochSupply;

    emit MiningParametersUpdated(inflationRate, startEpochSupply);
  }

  /// @notice How much supply is mintable from start timestamp till end timestamp
  /// @param start Start of the time interval (timestamp)
  /// @param end End of the time interval (timestamp)
  /// @return Tokens mintable from `start` till `end`
  function _mintableInTimeframe(uint256 start, uint256 end) internal view returns (uint256) {
    if (start > end) revert();

    uint256 currentEpochTime = _startEpochTime;
    uint256 currentRate = _rate;

    // It shouldn't be possible to over/underflow in here but we add checked maths to be safe

    // Special case if end is in future (not yet minted) epoch
    if (end > currentEpochTime + RATE_REDUCTION_TIME) {
      currentEpochTime = currentEpochTime + RATE_REDUCTION_TIME;
      currentRate = (currentRate * RATE_DENOMINATOR) / RATE_REDUCTION_COEFFICIENT;
    }

    if (end > currentEpochTime + RATE_REDUCTION_TIME) revert();

    uint256 toMint = 0;
    for (uint256 epoch = 0; epoch < 999; ++epoch) {
      if (end >= currentEpochTime) {
        uint256 currentEnd = end;
        if (currentEnd > currentEpochTime + RATE_REDUCTION_TIME) {
          currentEnd = currentEpochTime + RATE_REDUCTION_TIME;
        }

        uint256 currentStart = start;
        if (currentStart >= currentEpochTime + RATE_REDUCTION_TIME) {
          // We should never get here but what if...
          break;
        } else if (currentStart < currentEpochTime) {
          currentStart = currentEpochTime;
        }

        toMint += currentRate * (currentEnd - currentStart);

        if (start >= currentEpochTime) {
          break;
        }
      }

      currentEpochTime = currentEpochTime - RATE_REDUCTION_TIME;
      // double-division with rounding made rate a bit less => good
      currentRate = (currentRate * RATE_REDUCTION_COEFFICIENT) / RATE_DENOMINATOR;
    }

    return toMint;
  }
}
