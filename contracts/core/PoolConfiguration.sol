// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import { IAaveV3Pool } from "../interfaces/Aave/IAaveV3Pool.sol";
import { IFxUSDBasePool } from "../interfaces/IFxUSDBasePool.sol";
import { IPoolConfiguration } from "../interfaces/IPoolConfiguration.sol";
import { IFxUSDPriceOracle } from "../interfaces/IFxUSDPriceOracle.sol";
import { ILongPool } from "../interfaces/ILongPool.sol";
import { IShortPool } from "../interfaces/IShortPool.sol";

import { WordCodec } from "../common/codec/WordCodec.sol";

contract PoolConfiguration is AccessControlUpgradeable, IPoolConfiguration {
  using WordCodec for bytes32;

  /**********
   * Errors *
   **********/

  /// @dev Thrown when the value is too large.
  error ErrorValueTooLarge();

  /// @dev Thrown when the pool is invalid.
  error ErrorInvalidPool();

  /// @dev Thrown when the pool manager is locked.
  error ErrorPoolManagerLocked();

  /*************
   * Constants *
   *************/

  /// @dev The minimum Aave borrow index snapshot delay.
  uint256 private constant MIN_SNAPSHOT_DELAY = 30 minutes;

  /// @dev The precision used for fee ratio calculation.
  uint256 internal constant FEE_PRECISION = 1e9;

  /// @dev The precision used for various calculation.
  uint256 internal constant PRECISION = 1e18;

  /// @dev The offset of *supply ratio* in pool fee data.
  uint256 private constant SUPPLY_RATIO_OFFSET = 0;
  /// @dev The offset of *supply ratio step* in pool fee data
  uint256 private constant SUPPLY_RATIO_STEP_OFFSET = 30;
  /// @dev The offset of *withdraw fee ratio* in pool fee data.
  uint256 private constant WITHDRAW_FEE_RATIO_OFFSET = 90;
  /// @dev The offset of *borrow fee ratio* in pool fee data.
  uint256 private constant BORROW_FEE_RATIO_OFFSET = 120;
  /// @dev The offset of *repay fee ratio* in pool fee data.
  uint256 private constant REPAY_FEE_RATIO_OFFSET = 150;

  /// @dev The offset of *scalar A* in long funding ratio parameter.
  uint256 private constant SCALAR_A_OFFSET = 0;
  /// @dev The offset of *scalar B* in long funding ratio parameter.
  uint256 private constant SCALAR_B_OFFSET = 64;
  /// @dev The offset of *max fxUSD ratio* in long funding ratio parameter.
  uint256 private constant MAX_FXUSD_RATIO_OFFSET = 128;

  /// @dev The offset of *scalar C* in short funding ratio parameter.
  uint256 private constant SCALAR_C_OFFSET = 0;
  /// @dev The offset of *max borrow ratio* in short funding ratio parameter.
  uint256 private constant MAX_BORROW_RATIO_OFFSET = 64;

  /// @dev The key for pool manager lock.
  bytes32 private constant POOL_MANAGER_LOCK_KEY = keccak256("POOL_MANAGER_LOCK_KEY");

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The address of the Aave lending pool.
  address public immutable AAVE_LENDING_POOL;

  /// @notice The address of the Aave base asset.
  address public immutable AAVE_BASE_ASSET;

  /// @notice The address of the FxUSDBasePool contract.
  address public immutable FXUSD_BASE_POOL;

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

  /// @dev The encoding of pool fee ratio data.
  /// - The *supply ratio* is the fee ratio for opening position, multiplied by 1e9.
  /// - The *supply ratio step* is the fee ratio step for opening position, multiplied by 1e18.
  /// - The *withdraw fee ratio* is the fee ratio for closing position, multiplied by 1e9.
  /// - The *borrow fee ratio* is the borrow fee ratio for opening position, multiplied by 1e9.
  /// - The *repay fee ratio* is the repay fee ratio for closing position, multiplied by 1e9.
  ///
  /// [ supply ratio | supply ratio step | withdraw fee ratio | borrow fee ratio | repay fee ratio | reserved ]
  /// [   30  bits   |      60 bits      |      30  bits      |     30  bits     |     30 bits     | 76  bits ]
  /// [ MSB                                                                                               LSB ]
  struct PoolFeeRatioStruct {
    // no supply/withdraw fee, but with borrow and repay fee
    bytes32 defaultFeeRatio;
    mapping(address => bytes32) custom;
  }

  /*********************
   * Storage Variables *
   *********************/

  /// @notice The address of the oracle for fxUSD price.
  address public oracle;

  /// @notice The borrow rate snapshot.
  BorrowRateSnapshot public borrowRateSnapshot;

  /// @dev Mapping from pool address to the pool fee ratio.
  mapping(address => PoolFeeRatioStruct) private poolFeeRatio;

  /// @dev Mapping from pool address to the long funding ratio parameter.
  /// 1. When fxUSD price is below max price deviation (down depeg), the funding ratio is calculated by:
  /// ```
  /// funding_ratio = scalar_b * interest_rate
  /// ```
  /// 2. When the ratio of fxUSD in FxUSDBasePool is above `max_fxUSD_ratio`, the funding ratio is calculated by:
  /// ```
  /// funding_ratio = scalar_a * interest_rate
  /// ```
  ///
  /// The encoding is:
  /// - The *scalar A* is the scalar for funding ratio, multiplied by 1e18.
  /// - The *scalar B* is the scalar for funding ratio, multiplied by 1e18.
  /// - The *max fxUSD ratio* is the max fxUSD ratio in FxUSDBasePool, multiplied by 1e18.
  ///
  /// [ scalar_a | scalar_b | max_fxUSD_ratio | reserved ]
  /// [ 64  bits | 64  bits | 64  bits | 64  bits ]
  /// [ MS                                    LSB ]
  mapping(address => bytes32) private longFundingRatioParameter;

  /// @dev Mapping from pool address to the short funding ratio parameter.
  /// 1. When the ratio of borrowed collateral is above `max_borrow_ratio`, the funding ratio is calculated by:
  /// ```
  /// funding_ratio = scalar_c * interest_rate
  /// ```
  ///
  /// The encoding is:
  /// - The *scalar C* is the scalar for funding ratio, multiplied by 1e18.
  /// - The *max borrow ratio* is the max borrow ratio for funding ratio, multiplied by 1e18.
  ///
  /// [ scalar_c | max_borrow_ratio | reserved ]
  /// [ 64  bits |     64  bits     | 128 bits ]
  /// [ MS                                 LSB ]
  mapping(address => bytes32) private shortFundingRatioParameter;

  /// @notice The depeg price for stable token.
  uint256 public stableDepegPrice;

  /// @inheritdoc IPoolConfiguration
  mapping(bytes32 => address) public registry;

  /***************
   * Constructor *
   ***************/

  /// @notice Constructor.
  /// @param _fxUSDBasePool The address of the FxUSDBasePool contract.
  /// @param _aaveLendingPool The address of the Aave lending pool.
  /// @param _aaveBaseAsset The address of the Aave base asset.
  constructor(address _fxUSDBasePool, address _aaveLendingPool, address _aaveBaseAsset) {
    FXUSD_BASE_POOL = _fxUSDBasePool;
    AAVE_LENDING_POOL = _aaveLendingPool;
    AAVE_BASE_ASSET = _aaveBaseAsset;
  }

  /// @notice Initialize the contract storage.
  /// @param admin The address of the admin.
  /// @param _oracle The address of the oracle.
  function initialize(address admin, address _oracle) external initializer {
    __Context_init();
    __ERC165_init();
    __AccessControl_init();

    _grantRole(DEFAULT_ADMIN_ROLE, admin);
    _updateOracle(_oracle);

    uint256 borrowIndex = IAaveV3Pool(AAVE_LENDING_POOL).getReserveNormalizedVariableDebt(AAVE_BASE_ASSET);
    IAaveV3Pool.ReserveDataLegacy memory reserveData = IAaveV3Pool(AAVE_LENDING_POOL).getReserveData(AAVE_BASE_ASSET);
    _updateBorrowRateSnapshot(borrowIndex, reserveData.currentVariableBorrowRate / 1e9);
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc IPoolConfiguration
  function isBorrowAllowed() external view returns (bool) {
    return !IFxUSDPriceOracle(oracle).isPriceBelowMaxDeviation();
  }

  /// @inheritdoc IPoolConfiguration
  function isRedeemAllowed() external view returns (bool) {
    return IFxUSDPriceOracle(oracle).isPriceBelowMaxDeviation();
  }

  /// @inheritdoc IPoolConfiguration
  function isFundingEnabled() external view returns (bool) {
    return IFxUSDPriceOracle(oracle).isPriceBelowMaxDeviation();
  }

  /// @inheritdoc IPoolConfiguration
  function isStableRepayAllowed() external view returns (bool) {
    uint256 stablePrice = IFxUSDBasePool(FXUSD_BASE_POOL).getStableTokenPrice();
    return IFxUSDPriceOracle(oracle).isPriceAboveMaxDeviation() && stablePrice > stableDepegPrice;
  }

  /// @inheritdoc IPoolConfiguration
  function getPoolFeeRatio(
    address pool,
    address recipient
  )
    external
    view
    returns (uint256 supplyFeeRatio, uint256 withdrawFeeRatio, uint256 borrowFeeRatio, uint256 repayFeeRatio)
  {
    bytes32 data = poolFeeRatio[pool].custom[recipient];
    if (data == bytes32(0)) {
      data = poolFeeRatio[pool].defaultFeeRatio;
    }

    uint256 supplyRatio = data.decodeUint(SUPPLY_RATIO_OFFSET, 30);
    uint256 supplyRatioStep = data.decodeUint(SUPPLY_RATIO_STEP_OFFSET, 60);
    uint256 interestRate = _getAverageInterestRate(borrowRateSnapshot);
    unchecked {
      uint256 aaveRatio = interestRate <= supplyRatioStep ? 1 : (interestRate - 1) / supplyRatioStep;
      supplyFeeRatio = aaveRatio * supplyRatio;
    }
    withdrawFeeRatio = data.decodeUint(WITHDRAW_FEE_RATIO_OFFSET, 30);
    borrowFeeRatio = data.decodeUint(BORROW_FEE_RATIO_OFFSET, 30);
    repayFeeRatio = data.decodeUint(REPAY_FEE_RATIO_OFFSET, 30);
  }

  /// @inheritdoc IPoolConfiguration
  function getLongPoolFundingRatio(address pool) external view returns (uint256 fundingRatio) {
    bytes32 parameter = longFundingRatioParameter[pool];
    uint256 scalarA = parameter.decodeUint(SCALAR_A_OFFSET, 64);
    uint256 scalarB = parameter.decodeUint(SCALAR_B_OFFSET, 64);
    uint256 maxFxUSDratio = parameter.decodeUint(MAX_FXUSD_RATIO_OFFSET, 64);

    uint256 interestRate = _getAverageInterestRate(borrowRateSnapshot);
    if (IFxUSDPriceOracle(oracle).isPriceBelowMaxDeviation()) {
      fundingRatio = (scalarB * interestRate) / PRECISION;
    } else {
      // @dev This balance can be manipulated. However in order to manipulate the balance,
      // the user need to lock the funds into FxUSDBasePool for a certain duration. So it
      // is ok to use the balance directly.
      uint256 balanceFxUSD = IFxUSDBasePool(FXUSD_BASE_POOL).totalYieldToken();
      uint256 balanceStable = IFxUSDBasePool(FXUSD_BASE_POOL).totalStableToken();
      uint256 fxusdRatio;
      if (balanceStable == 0 && balanceFxUSD == 0) {
        fxusdRatio = maxFxUSDratio;
      } else {
        // we are using USDC as the stable token, the decimal is 6
        fxusdRatio = (balanceFxUSD * PRECISION) / (balanceStable * 1e12 + balanceFxUSD);
      }
      if (fxusdRatio >= maxFxUSDratio) {
        fundingRatio = (scalarA * interestRate) / PRECISION;
      } else {
        fundingRatio = 0;
      }
    }
  }

  /// @inheritdoc IPoolConfiguration
  function getShortPoolFundingRatio(address pool) external view returns (uint256 fundingRatio) {
    bytes32 parameter = shortFundingRatioParameter[pool];
    uint256 scalarC = parameter.decodeUint(SCALAR_C_OFFSET, 64);
    uint256 maxBorrowRatio = parameter.decodeUint(MAX_BORROW_RATIO_OFFSET, 64);

    uint256 interestRate = _getAverageInterestRate(borrowRateSnapshot);
    address counterparty = IShortPool(pool).counterparty();
    uint256 collateral = ILongPool(counterparty).getTotalRawCollaterals();
    uint256 debts = IShortPool(pool).getTotalRawDebts();
    uint256 debtRatio;
    if (collateral == 0) {
      debtRatio = 0;
    } else {
      debtRatio = (debts * PRECISION) / collateral;
    }
    if (debtRatio >= maxBorrowRatio) {
      fundingRatio = (scalarC * interestRate) / PRECISION;
    } else {
      fundingRatio = 0;
    }
  }

  /// @notice Get the average interest rate.
  /// @return rate The average interest rate, multiplied by 1e18.
  function getAverageInterestRate() external view returns (uint256) {
    return _getAverageInterestRate(borrowRateSnapshot);
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IPoolConfiguration
  /// @dev It is ok to let anyone call this function. However to reduce the unknown risk, we require the pool address is
  /// the same as the caller and the pool is whitelisted.
  function checkpoint(address pool) external {
    if (pool != _msgSender()) revert ErrorInvalidPool();
    if (poolFeeRatio[pool].defaultFeeRatio == bytes32(0)) revert ErrorInvalidPool();

    BorrowRateSnapshot memory snapshot = borrowRateSnapshot;
    uint256 duration = block.timestamp - snapshot.timestamp;
    if (duration >= MIN_SNAPSHOT_DELAY) {
      uint256 newBorrowIndex = IAaveV3Pool(AAVE_LENDING_POOL).getReserveNormalizedVariableDebt(AAVE_BASE_ASSET);
      uint256 lastInterestRate = _computeAverageInterestRate(snapshot.borrowIndex, newBorrowIndex, duration);
      if (lastInterestRate == 0) lastInterestRate = snapshot.lastInterestRate;

      _updateBorrowRateSnapshot(newBorrowIndex, lastInterestRate);
    }
  }

  /// @inheritdoc IPoolConfiguration
  /// @dev This function can be called by anyone. The state will be automatically cleared when the tx is over.
  function lock(address manager, bytes4 selector) external {
    bytes32 key = POOL_MANAGER_LOCK_KEY;
    bytes32 value;
    assembly {
      value := tload(key)
    }
    if (value != 0) {
        revert ErrorPoolManagerLocked();
    }
    assembly {
      tstore(key, 1)
    }
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Update the pool fee ratio for a specific recipient.
  /// @param pool The address of the pool.
  /// @param recipient The address of the recipient.
  /// @param supplyRatio The supply ratio, multiplied by 1e9.
  /// @param supplyRatioStep The supply ratio step, multiplied by 1e18.
  /// @param withdrawFeeRatio The withdraw fee ratio, multiplied by 1e9.
  /// @param borrowFeeRatio The borrow fee ratio, multiplied by 1e9.
  /// @param repayFeeRatio The repay fee ratio, multiplied by 1e9.
  function updatePoolFeeRatio(
    address pool,
    address recipient,
    uint256 supplyRatio,
    uint256 supplyRatioStep,
    uint256 withdrawFeeRatio,
    uint256 borrowFeeRatio,
    uint256 repayFeeRatio
  ) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _checkValueTooLarge(supplyRatio, 1e9);
    _checkValueTooLarge(supplyRatioStep, 1e18);
    _checkValueTooLarge(withdrawFeeRatio, 1e9);
    _checkValueTooLarge(borrowFeeRatio, 1e9);
    _checkValueTooLarge(repayFeeRatio, 1e9);

    bytes32 data;
    data = data.insertUint(supplyRatio, SUPPLY_RATIO_OFFSET, 30);
    data = data.insertUint(supplyRatioStep, SUPPLY_RATIO_STEP_OFFSET, 60);
    data = data.insertUint(withdrawFeeRatio, WITHDRAW_FEE_RATIO_OFFSET, 30);
    data = data.insertUint(borrowFeeRatio, BORROW_FEE_RATIO_OFFSET, 30);
    data = data.insertUint(repayFeeRatio, REPAY_FEE_RATIO_OFFSET, 30);

    if (recipient == address(0)) {
      poolFeeRatio[pool].defaultFeeRatio = data;
    } else {
      poolFeeRatio[pool].custom[recipient] = data;
    }

    emit UpdatePoolFeeRatio(
      pool,
      recipient,
      supplyRatio,
      supplyRatioStep,
      withdrawFeeRatio,
      borrowFeeRatio,
      repayFeeRatio
    );
  }

  /// @notice Update the funding ratio parameter.
  /// @param pool The address of the pool.
  /// @param scalarA The scalar A, multiplied by 1e18.
  /// @param scalarB The scalar B, multiplied by 1e18.
  /// @param maxFxUSDratio The max fxUSD ratio, multiplied by 1e18.
  function updateLongFundingRatioParameter(
    address pool,
    uint64 scalarA,
    uint64 scalarB,
    uint64 maxFxUSDratio
  ) external onlyRole(DEFAULT_ADMIN_ROLE) {
    bytes32 parameter;
    parameter = parameter.insertUint(scalarA, SCALAR_A_OFFSET, 64);
    parameter = parameter.insertUint(scalarB, SCALAR_B_OFFSET, 64);
    parameter = parameter.insertUint(maxFxUSDratio, MAX_FXUSD_RATIO_OFFSET, 64);
    longFundingRatioParameter[pool] = parameter;

    emit UpdateLongFundingRatioParameter(scalarA, scalarB, maxFxUSDratio);
  }

  /// @notice Update the short funding ratio parameter.
  /// @param pool The address of the pool.
  /// @param scalarC The scalar C, multiplied by 1e18.
  /// @param maxBorrowRatio The max borrow ratio, multiplied by 1e18.
  function updateShortFundingRatioParameter(
    address pool,
    uint64 scalarC,
    uint64 maxBorrowRatio
  ) external onlyRole(DEFAULT_ADMIN_ROLE) {
    bytes32 parameter;
    parameter = parameter.insertUint(scalarC, SCALAR_C_OFFSET, 64);
    parameter = parameter.insertUint(maxBorrowRatio, MAX_BORROW_RATIO_OFFSET, 64);
    shortFundingRatioParameter[pool] = parameter;

    emit UpdateShortFundingRatioParameter(scalarC, maxBorrowRatio);
  }

  /// @notice Update the address of oracle.
  /// @param newOracle The address of new oracle.
  function updateOracle(address newOracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateOracle(newOracle);
  }

  /// @notice Update the stable depeg price.
  /// @param newStableDepegPrice The new stable depeg price.
  function updateStableDepegPrice(uint256 newStableDepegPrice) external onlyRole(DEFAULT_ADMIN_ROLE) {
    uint256 oldStableDepegPrice = stableDepegPrice;
    stableDepegPrice = newStableDepegPrice;
    emit UpdateStableDepegPrice(oldStableDepegPrice, newStableDepegPrice);
  }

  /// @notice Register an address.
  /// @param key The key of the registered address.
  /// @param addr The address to register.
  function register(bytes32 key, address addr) external onlyRole(DEFAULT_ADMIN_ROLE) {
    registry[key] = addr;

    emit Register(key, addr);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to update the address of oracle.
  /// @param newOracle The address of new oracle.
  function _updateOracle(address newOracle) internal {
    address oldOracle = oracle;
    oracle = newOracle;

    emit UpdateOracle(oldOracle, newOracle);
  }

  /// @dev Internal function to return interest rate snapshot.
  /// @param snapshot The previous borrow index snapshot.
  /// @return rate The annual interest rate, multiplied by 1e18.
  function _getAverageInterestRate(BorrowRateSnapshot memory snapshot) internal view returns (uint256 rate) {
    // absolute rate change is (new - prev) / prev
    // annual interest rate is (new - prev) / prev / duration * 365 days
    uint256 duration = block.timestamp - snapshot.timestamp;
    // @note Users can trigger this every `MIN_SNAPSHOT_DELAY` seconds and make the interest rate never change.
    // We allow users to do so, since the risk is not very high. And if we remove this if, the computed interest
    // rate may not correct due to small `duration`.
    if (duration < MIN_SNAPSHOT_DELAY) {
      rate = snapshot.lastInterestRate;
    } else {
      uint256 prevBorrowIndex = snapshot.borrowIndex;
      uint256 newBorrowIndex = IAaveV3Pool(AAVE_LENDING_POOL).getReserveNormalizedVariableDebt(AAVE_BASE_ASSET);
      rate = _computeAverageInterestRate(prevBorrowIndex, newBorrowIndex, duration);
      if (rate == 0) rate = snapshot.lastInterestRate;
    }
  }

  /// @dev Internal function to compute the average interest rate.
  /// @param prevBorrowIndex The previous borrow index.
  /// @param newBorrowIndex The new borrow index.
  /// @param duration The duration of the snapshot.
  /// @return rate The average interest rate, multiplied by 1e18.
  function _computeAverageInterestRate(
    uint256 prevBorrowIndex,
    uint256 newBorrowIndex,
    uint256 duration
  ) internal pure returns (uint256 rate) {
    rate = ((newBorrowIndex - prevBorrowIndex) * 365 days * PRECISION) / (prevBorrowIndex * duration);
  }

  /// @dev Internal function to update the borrow rate snapshot.
  /// @param borrowIndex The borrow index to update.
  /// @param interestRate The interest rate to update.
  function _updateBorrowRateSnapshot(uint256 borrowIndex, uint256 interestRate) internal {
    borrowRateSnapshot = BorrowRateSnapshot({
      borrowIndex: uint128(borrowIndex),
      lastInterestRate: uint80(interestRate),
      timestamp: uint48(block.timestamp)
    });

    emit Snapshot(borrowIndex, interestRate, block.timestamp);
  }

  /// @dev Internal function to check value not too large.
  /// @param value The value to check.
  /// @param upperBound The upper bound for the given value.
  function _checkValueTooLarge(uint256 value, uint256 upperBound) internal pure {
    if (value > upperBound) revert ErrorValueTooLarge();
  }
}
