// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import { IGovernanceToken } from "./interfaces/IGovernanceToken.sol";
import { ITokenMinter } from "./interfaces/ITokenMinter.sol";

contract TokenMinter is AccessControlUpgradeable, ITokenMinter {
  /**********
   * Errors *
   **********/

  error ErrorMintExceedsAvailableSupply();

  error ErrorEpochNotFinished();

  error ErrorInvalidTimeframe();

  error ErrorTooFarInFuture();

  /*************
   * Constants *
   *************/

  /// @notice The role for token minter.
  bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

  /// @dev The parameters for token inflation.
  uint256 private constant RATE_REDUCTION_TIME = 365 days;
  uint256 private constant RATE_DENOMINATOR = 1e18;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @inheritdoc ITokenMinter
  address public immutable token;

  /*********************
   * Storage Variables *
   *********************/

  // Supply Variables
  uint256 public rateReductionCoefficient;
  uint256 private _miningEpoch;
  uint256 private _startEpochTime;
  uint256 private _startEpochSupply;
  uint256 private _rate;

  /***************
   * Constructor *
   ***************/

  constructor(address _token) {
    token = _token;
  }

  function initialize(uint256 _initSupply, uint256 _initRate, uint256 _rateReductionCoefficient) external initializer {
    __Context_init(); // from ContextUpgradeable
    __ERC165_init(); // from ERC165Upgradeable
    __AccessControl_init(); // from AccessControlUpgradeable

    _startEpochSupply = _initSupply;
    _startEpochTime = block.timestamp;
    _rate = _initRate;
    rateReductionCoefficient = _rateReductionCoefficient;

    emit MiningParametersUpdated(_initRate, _initSupply);

    IGovernanceToken(token).mint(_msgSender(), _initSupply);
    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc ITokenMinter
  function getMiningEpoch() external view returns (uint256) {
    return _miningEpoch;
  }

  /// @inheritdoc ITokenMinter
  function getStartEpochTime() external view returns (uint256) {
    return _startEpochTime;
  }

  /// @inheritdoc ITokenMinter
  function getFutureEpochTime() external view returns (uint256) {
    return _startEpochTime + RATE_REDUCTION_TIME;
  }

  /// @inheritdoc ITokenMinter
  function getStartEpochSupply() external view returns (uint256) {
    return _startEpochSupply;
  }

  /// @inheritdoc ITokenMinter
  function getInflationRate() external view returns (uint256) {
    return _rate;
  }

  /// @inheritdoc ITokenMinter
  function getAvailableSupply() external view returns (uint256) {
    return _availableSupply();
  }

  /// @inheritdoc ITokenMinter
  function mintableInTimeframe(uint256 start, uint256 end) external view returns (uint256) {
    return _mintableInTimeframe(start, end);
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc ITokenMinter
  function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
    // Check if we've passed into a new epoch such that we should calculate available supply with a smaller rate.
    if (block.timestamp >= _startEpochTime + RATE_REDUCTION_TIME) {
      _updateMiningParameters();
    }

    if (IGovernanceToken(token).totalSupply() + amount > _availableSupply()) {
      revert ErrorMintExceedsAvailableSupply();
    }

    IGovernanceToken(token).mint(to, amount);
  }

  /// @inheritdoc ITokenMinter
  function startEpochTimeWrite() external returns (uint256) {
    return _startEpochTimeWrite();
  }

  /// @inheritdoc ITokenMinter
  function futureEpochTimeWrite() external returns (uint256) {
    return _startEpochTimeWrite() + RATE_REDUCTION_TIME;
  }

  /// @inheritdoc ITokenMinter
  function updateMiningParameters() external {
    if (block.timestamp < _startEpochTime + RATE_REDUCTION_TIME) {
      revert ErrorEpochNotFinished();
    }
    _updateMiningParameters();
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to compute the maximum allowable number of tokens in existence (claimed or unclaimed)
  function _availableSupply() internal view returns (uint256) {
    uint256 newSupplyFromCurrentEpoch = (block.timestamp - _startEpochTime) * _rate;
    return _startEpochSupply + newSupplyFromCurrentEpoch;
  }

  /// @dev Internal function to get timestamp of the current mining epoch start while simultaneously updating mining parameters
  /// @return Timestamp of the current epoch
  function _startEpochTimeWrite() internal returns (uint256) {
    uint256 startEpochTime = _startEpochTime;
    if (block.timestamp >= startEpochTime + RATE_REDUCTION_TIME) {
      _updateMiningParameters();
      return _startEpochTime;
    }
    return startEpochTime;
  }

  /// @dev Internal function to update mining parameters.
  function _updateMiningParameters() internal {
    uint256 inflationRate = _rate;
    uint256 startEpochSupply = _startEpochSupply + inflationRate * RATE_REDUCTION_TIME;
    inflationRate = (inflationRate * RATE_DENOMINATOR) / rateReductionCoefficient;

    _miningEpoch += 1;
    _startEpochTime += RATE_REDUCTION_TIME;
    _rate = inflationRate;
    _startEpochSupply = startEpochSupply;

    emit MiningParametersUpdated(inflationRate, startEpochSupply);
  }

  /// @dev Internal function to compute supply is mintable from start timestamp till end timestamp
  /// @param start Start of the time interval (timestamp)
  /// @param end End of the time interval (timestamp)
  /// @return Tokens mintable from `start` till `end`
  function _mintableInTimeframe(uint256 start, uint256 end) internal view returns (uint256) {
    if (start > end) {
      revert ErrorInvalidTimeframe();
    }

    uint256 currentEpochTime = _startEpochTime;
    uint256 currentRate = _rate;

    // It shouldn't be possible to over/underflow in here but we add checked maths to be safe

    // Special case if end is in future (not yet minted) epoch
    if (end > currentEpochTime + RATE_REDUCTION_TIME) {
      currentEpochTime = currentEpochTime + RATE_REDUCTION_TIME;
      currentRate = (currentRate * RATE_DENOMINATOR) / rateReductionCoefficient;
    }

    if (end > currentEpochTime + RATE_REDUCTION_TIME) {
      revert ErrorTooFarInFuture();
    }

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
      currentRate = (currentRate * rateReductionCoefficient) / RATE_DENOMINATOR;
    }

    return toMint;
  }
}
