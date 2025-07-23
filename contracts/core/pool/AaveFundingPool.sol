// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IPoolConfiguration } from "../../interfaces/IPoolConfiguration.sol";

import { Math } from "../../libraries/Math.sol";
import { BasePool } from "./BasePool.sol";

contract AaveFundingPool is BasePool {
  /// @dev Error when reducing more than total collateral.
  error ErrorReduceTooMuchCollateral();

  /***********
   * Structs *
   ***********/

  /// @dev The struct for AAVE borrow rate snapshot.
  /// @param borrowIndex The current borrow index of AAVE, multiplied by 1e27.
  /// @param lastInterestRate The last recorded interest rate, multiplied by 1e18.
  /// @param timestamp The timestamp when the snapshot is taken.
  struct BorrowRateSnapshot {
    // The initial value of `borrowIndex` is `10^27`, it is very unlikely this value will exceed `2^128`.
    uint128 borrowIndex;
    uint80 lastInterestRate;
    uint48 timestamp;
  }

  /*********************
   * Storage Variables *
   *********************/

  /// @dev deprecated
  /// @dev `fundingMiscData` is a storage slot that can be used to store unrelated pieces of information.
  ///
  /// - The *open ratio* is the fee ratio for opening position, multiplied by 1e9.
  /// - The *open ratio step* is the fee ratio step for opening position, multiplied by 1e18.
  /// - The *close fee ratio* is the fee ratio for closing position, multiplied by 1e9.
  /// - The *funding ratio* is the scalar for funding rate, multiplied by 1e9.
  ///   The maximum value is `4.294967296`.
  ///
  /// [ open ratio | open ratio step | close fee ratio | funding ratio | reserved ]
  /// [  30  bits  |     60 bits     |     30 bits     |    32 bits    | 104 bits ]
  /// [ MSB                                                                   LSB ]
  bytes32 private fundingMiscData;

  /// @notice The snapshot for AAVE borrow rate.
  /// @dev `borrowIndex` and `lastInterestRate` are deprecated
  BorrowRateSnapshot public borrowRateSnapshot;

  /***************
   * Constructor *
   ***************/

  constructor(address _poolManager, address _configuration) BasePool(_poolManager, _configuration) {}

  function initialize(
    address admin,
    string memory name_,
    string memory symbol_,
    address _collateralToken,
    address _priceOracle
  ) external initializer {
    // __Context_init();
    // __ERC165_init();
    __ERC721_init(name_, symbol_);
    // __AccessControl_init();

    __PoolStorage_init(_collateralToken, _priceOracle);
    __TickLogic_init();
    __PositionLogic_init();
    __BasePool_init();

    _grantRole(DEFAULT_ADMIN_ROLE, admin);

    borrowRateSnapshot.timestamp = uint40(block.timestamp);
  }

  function reduceCollateral(uint256 amount) external onlyPoolManager {
    (, uint256 totalColls) = _getDebtAndCollateralShares();
    (, uint256 collIndex) = _getDebtAndCollateralIndex();
    uint256 totalRawColls = _convertToRawColl(totalColls, collIndex, Math.Rounding.Down);
    if (totalRawColls < amount) {
      revert ErrorReduceTooMuchCollateral();
    }

    uint256 newCollIndex = (collIndex * totalRawColls) / (totalRawColls - amount);
    _updateCollateralIndex(newCollIndex);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @inheritdoc BasePool
  function _updateCollAndDebtIndex() internal virtual override returns (uint256 newCollIndex, uint256 newDebtIndex) {
    (newDebtIndex, newCollIndex) = _getDebtAndCollateralIndex();

    BorrowRateSnapshot memory snapshot = borrowRateSnapshot;
    uint256 duration = block.timestamp - snapshot.timestamp;
    if (duration > 0) {
      uint256 fundingRatio = IPoolConfiguration(configuration).getLongPoolFundingRatio(address(this));
      if (fundingRatio > 0) {
        (, uint256 totalColls) = _getDebtAndCollateralShares();
        uint256 totalRawColls = _convertToRawColl(totalColls, newCollIndex, Math.Rounding.Down);
        uint256 funding = (totalRawColls * fundingRatio * duration) / (PRECISION * 365 days);

        // update collateral index with funding costs
        newCollIndex = (newCollIndex * totalRawColls) / (totalRawColls - funding);
        _updateCollateralIndex(newCollIndex);
      }

      // checkpoint on pool configuration
      IPoolConfiguration(configuration).checkpoint(address(this));

      borrowRateSnapshot.timestamp = uint40(block.timestamp);
    }
  }

  /// @inheritdoc BasePool
  function _deductProtocolFees(int256) internal view virtual override returns (uint256) {
    return 0;
  }
}
