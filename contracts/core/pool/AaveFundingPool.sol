// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IAaveV3Pool } from "../../interfaces/Aave/IAaveV3Pool.sol";
import { IAaveFundingPool } from "../../interfaces/IAaveFundingPool.sol";
import { IPegKeeper } from "../../interfaces/IPegKeeper.sol";

import { WordCodec } from "../../common/codec/WordCodec.sol";
import { BasePool } from "./BasePool.sol";

contract AaveFundingPool is BasePool, IAaveFundingPool {
  using WordCodec for bytes32;

  /*************
   * Constants *
   *************/

  /// @dev The offset of *open ratio* in `fundingMiscData`.
  uint256 private constant OPEN_RATIO_OFFSET = 0;

  /// @dev The offset of *open ratio step* in `fundingMiscData`.
  uint256 private constant OPEN_RATIO_STEP_OFFSET = 30;

  /// @dev The offset of *close fee ratio* in `fundingMiscData`.
  uint256 private constant CLOSE_FEE_RATIO_OFFSET = 90;

  /// @dev The offset of *funding ratio* in `fundingMiscData`.
  uint256 private constant FUNDING_RATIO_OFFSET = 120;

  /// @dev The offset of *interest rate* in `fundingMiscData`.
  uint256 private constant INTEREST_RATE_OFFSET = 152;

  /// @dev The offset of *timestamp* in `fundingMiscData`.
  uint256 private constant TIMESTAMP_OFFSET = 220;

  /// @dev The maximum value of *funding ratio*.
  uint256 private constant MAX_FUNDING_RATIO = 4294967295;

  /// @dev The maximum value of *interest rate*.
  uint256 private constant MAX_INTEREST_RATE = 295147905179352825855;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @dev The address of Aave V3 `LendingPool` contract.
  address private immutable lendingPool;

  /// @dev The address of asset used for interest calculation.
  address private immutable baseAsset;

  /*********************
   * Storage Variables *
   *********************/

  /// @dev `fundingMiscData` is a storage slot that can be used to store unrelated pieces of information.
  ///
  /// - The *open ratio* is the fee ratio for opening position, multiplied by 1e9.
  /// - The *open ratio step* is the fee ratio step for opening position, multiplied by 1e18.
  /// - The *close fee ratio* is the fee ratio for closing position, multiplied by 1e9.
  /// - The *funding ratio* is the scalar for funding rate, multiplied by 1e9.
  ///   The maximum value is `4.294967296`.
  /// - The *interest ratio* is the annual interest rate for the given asset, multiplied by 1e18.
  ///   The maximum value is `295.147905179352825856`.
  /// - The *timestamp* is the timestamp when the *interest ratio* snapshot was taken.
  ///   The maximum value is `68719476735`, enough for about `2179` years.
  ///
  /// [ open ratio | open ratio step | close fee ratio | funding ratio | interest rate | timestamp ]
  /// [  30  bits  |     60 bits     |     30 bits     |    32 bits    |    68 bits    |  36 bits  ]
  /// [ MSB                                                                                    LSB ]
  bytes32 private fundingMiscData;

  /***************
   * Constructor *
   ***************/

  constructor(address _poolManager, address _lendingPool, address _baseAsset) BasePool(_poolManager) {
    _checkAddressNotZero(_lendingPool);
    _checkAddressNotZero(_baseAsset);

    lendingPool = _lendingPool;
    baseAsset = _baseAsset;
  }

  function initialize(
    address admin,
    string memory name_,
    string memory symbol_,
    address _collateralToken,
    address _priceOracle
  ) external initializer {
    __Context_init();
    __ERC165_init();
    __ERC721_init(name_, symbol_);
    __AccessControl_init();

    __PoolStorage_init(_collateralToken, _priceOracle);
    __TickLogic_init();
    __PositionLogic_init();
    __BasePool_init();

    _grantRole(DEFAULT_ADMIN_ROLE, admin);

    _updateOpenRatio(1000000, 50000000000000000); // 0.1% and 5%
    _updateCloseRatio(1000000); // 0.1%
    _updateInterestRate();
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Return the value of funding ratio, multiplied by 1e9.
  function getFundingRatio() external view returns (uint256) {
    return _getFundingRatio();
  }

  /// @notice Return the fee ratio for opening position, multiplied by 1e9.
  function getOpenFeeRatio() public view returns (uint256) {
    (uint256 openRatio, uint256 openRatioStep) = _getOpenRatio();
    (uint256 rate, ) = _getInterestRate();
    unchecked {
      uint256 aaveRatio = rate <= openRatioStep ? 1 : (rate - openRatioStep) / openRatioStep;
      return aaveRatio * openRatio;
    }
  }

  /// @notice Return the fee ratio for closing position, multiplied by 1e9.
  function getCloseFeeRatio() external view returns (uint256) {
    return _getCloseFeeRatio();
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Update the fee ratio for opening position.
  /// @param ratio The open ratio value, multiplied by 1e9.
  /// @param step The open ratio step value, multiplied by 1e18.
  function updateOpenRatio(uint256 ratio, uint256 step) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateOpenRatio(ratio, step);
  }

  /// @notice Update the fee ratio for closing position.
  /// @param ratio The close ratio value, multiplied by 1e9.
  function updateCloseRatio(uint256 ratio) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateCloseRatio(ratio);
  }

  /// @notice Update the funding ratio.
  /// @param ratio The funding ratio value, multiplied by 1e9.
  function updateFundingRatio(uint256 ratio) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateFundingRatio(ratio);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to get open ratio and open ratio step.
  /// @return ratio The value of open ratio, multiplied by 1e9.
  /// @return step The value of open ratio step, multiplied by 1e18.
  function _getOpenRatio() internal view returns (uint256 ratio, uint256 step) {
    bytes32 data = fundingMiscData;
    ratio = data.decodeUint(OPEN_RATIO_OFFSET, 30);
    step = data.decodeUint(OPEN_RATIO_STEP_OFFSET, 60);
  }

  /// @dev Internal function to update the fee ratio for opening position.
  /// @param ratio The open ratio value, multiplied by 1e9.
  /// @param step The open ratio step value, multiplied by 1e18.
  function _updateOpenRatio(uint256 ratio, uint256 step) internal {
    _checkValueTooLarge(ratio, FEE_PRECISION);
    _checkValueTooLarge(step, PRECISION);

    bytes32 data = fundingMiscData;
    data = data.insertUint(ratio, OPEN_RATIO_OFFSET, 30);
    fundingMiscData = data.insertUint(step, OPEN_RATIO_STEP_OFFSET, 60);
  }

  /// @dev Internal function to get the value of close ratio, multiplied by 1e9.
  function _getCloseFeeRatio() internal view returns (uint256) {
    return fundingMiscData.decodeUint(CLOSE_FEE_RATIO_OFFSET, 30);
  }

  /// @dev Internal function to update the fee ratio for closing position.
  /// @param ratio The close ratio value, multiplied by 1e9.
  function _updateCloseRatio(uint256 ratio) internal {
    _checkValueTooLarge(ratio, FEE_PRECISION);

    fundingMiscData = fundingMiscData.insertUint(ratio, CLOSE_FEE_RATIO_OFFSET, 30);
  }

  /// @dev Internal function to get the value of funding ratio, multiplied by 1e9.
  function _getFundingRatio() internal view returns (uint256) {
    return fundingMiscData.decodeUint(FUNDING_RATIO_OFFSET, 32);
  }

  /// @dev Internal function to update the funding ratio.
  /// @param ratio The funding ratio value, multiplied by 1e9.
  function _updateFundingRatio(uint256 ratio) internal {
    _checkValueTooLarge(ratio, MAX_FUNDING_RATIO);

    fundingMiscData = fundingMiscData.insertUint(ratio, FUNDING_RATIO_OFFSET, 32);
  }

  /// @dev Internal function to return interest rate snapshot.
  /// @param rate The snapshot interest rate, multiplied by 1e18.
  /// @param timestamp The snapshot timestamp.
  function _getInterestRate() internal view returns (uint256 rate, uint256 timestamp) {
    bytes32 data = fundingMiscData;
    rate = data.decodeUint(INTEREST_RATE_OFFSET, 68);
    timestamp = data.decodeUint(TIMESTAMP_OFFSET, 36);
  }

  /// @dev Internal function to update interest rate snapshot.
  function _updateInterestRate() internal {
    IAaveV3Pool.ReserveDataLegacy memory reserveData = IAaveV3Pool(lendingPool).getReserveData(baseAsset);
    // the interest rate from aave is scaled by 1e27, we want 1e18 scale.
    uint256 rate = reserveData.currentVariableBorrowRate / 1e9;
    if (rate > MAX_INTEREST_RATE) rate = MAX_INTEREST_RATE;

    bytes32 data = fundingMiscData;
    data = data.insertUint(rate, INTEREST_RATE_OFFSET, 68);
    fundingMiscData = data.insertUint(block.timestamp, TIMESTAMP_OFFSET, 36);

    emit SnapshotAaveInterestRate(rate, block.timestamp);
  }

  /// @inheritdoc BasePool
  function _updateCollAndDebtIndex() internal virtual override returns (uint256 newCollIndex, uint256 newDebtIndex) {
    (newDebtIndex, newCollIndex) = _getDebtAndCollateralIndex();

    (uint256 oldInterestRate, uint256 snapshotTimestamp) = _getInterestRate();
    if (block.timestamp > snapshotTimestamp) {
      if (IPegKeeper(pegKeeper).isFundingEnabled()) {
        (, uint256 totalColls) = _getDebtAndCollateralShares();
        uint256 totalRawColls = _convertToRawColl(totalColls, newCollIndex);
        uint256 funding = (totalRawColls * oldInterestRate * (block.timestamp - snapshotTimestamp)) / (365 * 86400);
        funding = ((funding * _getFundingRatio()) / FEE_PRECISION);

        // update collateral index with funding costs
        newCollIndex = (newCollIndex * totalRawColls) / (totalRawColls - funding);
        _updateCollateralIndex(newCollIndex);
      }

      // update interest snapshot
      _updateInterestRate();
    }
  }

  /// @inheritdoc BasePool
  function _deductProtocolFees(int256 rawColl) internal view virtual override returns (uint256) {
    if (rawColl > 0) {
      // open position or add collateral
      return (uint256(rawColl) * getOpenFeeRatio()) / FEE_PRECISION;
    } else {
      // close position or remove collateral
      return (uint256(-rawColl) * _getCloseFeeRatio()) / FEE_PRECISION;
    }
  }
}
