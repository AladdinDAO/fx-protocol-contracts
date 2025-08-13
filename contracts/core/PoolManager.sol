// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { ICreditNote } from "../interfaces/ICreditNote.sol";
import { IFxUSDRegeneracy } from "../interfaces/IFxUSDRegeneracy.sol";
import { ILongPoolManager } from "../interfaces/ILongPoolManager.sol";
import { ILongPool } from "../interfaces/ILongPool.sol";
import { IPoolConfiguration } from "../interfaces/IPoolConfiguration.sol";
import { IPoolManager } from "../interfaces/IPoolManager.sol";
import { IShortPool } from "../interfaces/IShortPool.sol";
import { IReservePool } from "../interfaces/IReservePool.sol";
import { IFxUSDBasePool } from "../interfaces/IFxUSDBasePool.sol";
import { IRateProvider } from "../rate-provider/interfaces/IRateProvider.sol";
import { ISmartWalletChecker } from "../voting-escrow/interfaces/ISmartWalletChecker.sol";
import { WordCodec } from "../common/codec/WordCodec.sol";
import { AssetManagement } from "../fund/AssetManagement.sol";
import { FlashLoans } from "./FlashLoans.sol";
import { ProtocolFees } from "./ProtocolFees.sol";

contract PoolManager is ProtocolFees, FlashLoans, AssetManagement, ILongPoolManager {
  using EnumerableSet for EnumerableSet.AddressSet;
  using SafeERC20 for IERC20;
  using WordCodec for bytes32;

  /**********
   * Errors *
   **********/

  error ErrorCollateralExceedCapacity();

  error ErrorDebtExceedCapacity();

  error ErrorPoolNotRegistered();

  error ErrorInvalidPool();

  error ErrorCallerNotFxUSDSave();

  error ErrorRedeemExceedBalance();

  error ErrorInsufficientRedeemedCollateral();

  error ErrorBorrowExceedCapacity();

  error ErrorCallerNotCounterparty();

  error ErrorInvalidLongShortPair();

  error ErrorStableRepayNotAllowed();

  error ErrorInvalidOperation();

  error ErrorRedeemDebtsTooSmall();

  error ErrorRebalanceDebtsTooSmall();

  error ErrorRedeemNotAllowed();

  error ErrorLiquidateDebtsTooSmall();

  error ErrorTopLevelCall();

  /*************
   * Constants *
   *************/

  /// @dev The role for emergency operations.
  bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

  /// @dev The role for debt reducer.
  bytes32 public constant DEBT_REDUCER_ROLE = keccak256("DEBT_REDUCER_ROLE");

  /// @dev The role for harvester
  bytes32 public constant HARVESTER_ROLE = keccak256("HARVESTER_ROLE");

  /// @dev The key for pool rewards treasury.
  bytes32 private constant POOL_REWARDS_TREASURY_KEY = keccak256("PoolRewardsTreasury");

  /// @dev The key for pool funding treasury.
  bytes32 private constant POOL_FUNDING_TREASURY_KEY = keccak256("PoolFundingTreasury");

  /// @dev The precision for token rate.
  uint256 internal constant PRECISION = 1e18;

  /// @dev The precision for token rate.
  int256 internal constant PRECISION_I256 = 1e18;

  uint256 private constant COLLATERAL_CAPACITY_OFFSET = 0;
  uint256 private constant COLLATERAL_BALANCE_OFFSET = 85;
  uint256 private constant RAW_COLLATERAL_BALANCE_OFFSET = 170;
  uint256 private constant COLLATERAL_DATA_BITS = 85;
  uint256 private constant RAW_COLLATERAL_DATA_BITS = 86;

  uint256 private constant DEBT_CAPACITY_OFFSET = 0;
  uint256 private constant DEBT_BALANCE_OFFSET = 96;
  uint256 private constant DEBT_DATA_BITS = 96;

  uint256 private constant MIN_REDEEM_DEBTS = 100 ether;

  uint256 private constant MIN_REBALANCE_DEBTS = 1 ether;

  uint256 private constant MIN_LIQUIDATE_DEBTS = 1 ether;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @inheritdoc IPoolManager
  address public immutable fxUSD;

  /// @inheritdoc IPoolManager
  address public immutable counterparty;

  /// @inheritdoc IPoolManager
  address public immutable configuration;

  /// @inheritdoc ILongPoolManager
  address public immutable fxBASE;

  /// @notice The address of smart wallet whitelist.
  address public immutable whitelist;

  /***********
   * Structs *
   ***********/

  /// @dev The struct for pool information.
  /// @param collateralData The data for collateral.
  ///   ```text
  ///   * Field                     Bits    Index       Comments
  ///   * collateral capacity       85      0           The maximum allowed amount of collateral tokens.
  ///   * collateral balance        85      85          The amount of collateral tokens deposited.
  ///   * raw collateral balance    86      170         The amount of raw collateral tokens (without token rate) managed in pool.
  ///   ```
  /// @param debtData The data for debt.
  ///   ```text
  ///   * Field             Bits    Index       Comments
  ///   * debt capacity     96      0           The maximum allowed amount of debt tokens.
  ///   * debt balance      96      96          The amount of debt tokens borrowed.
  ///   * reserved          64      192         Reserved data.
  ///   ```
  struct PoolStruct {
    bytes32 collateralData;
    bytes32 debtData;
  }

  /// @dev The struct for token rate information.
  /// @param scalar The token scalar to reach 18 decimals.
  /// @param rateProvider The address of token rate provider.
  struct TokenRate {
    uint96 scalar;
    address rateProvider;
  }

  /// @dev Memory variables for liquidate or rebalance.
  /// @param stablePrice The USD price of stable token (with scalar).
  /// @param scalingFactor The scaling factor for collateral token.
  /// @param collateralToken The address of collateral token.
  /// @param rawColls The amount of raw collateral tokens liquidated or rebalanced, including bonus.
  /// @param bonusRawColls The amount of raw collateral tokens used as bonus.
  /// @param rawDebts The amount of raw debt tokens liquidated or rebalanced.
  struct LiquidateOrRebalanceMemoryVar {
    uint256 stablePrice;
    uint256 scalingFactor;
    address collateralToken;
    uint256 rawColls;
    uint256 bonusRawColls;
    uint256 rawDebts;
  }

  struct OperationMemoryVar {
    uint256 stablePrice;
    uint256 poolSupplyFeeRatio;
    uint256 poolWithdrawFeeRatio;
    uint256 poolBorrowFeeRatio;
    uint256 poolRepayFeeRatio;
    address referral;
    uint256 referralSupplyFeeRatio;
    uint256 referralWithdrawFeeRatio;
    uint256 referralBorrowFeeRatio;
    uint256 referralRepayFeeRatio;
  }

  /*********************
   * Storage Variables *
   *********************/

  /// @dev The list of registered pools.
  EnumerableSet.AddressSet private pools;

  /// @notice Mapping to pool address to pool struct.
  mapping(address => PoolStruct) private poolInfo;

  /// @notice Mapping from pool address to rewards splitter.
  /// @custom:deprecated This field is no longer used.
  mapping(address => address) public rewardSplitter;

  /// @notice Mapping from token address to token rate struct.
  mapping(address => TokenRate) public tokenRates;

  /// @notice The threshold for permissioned liquidate or rebalance.
  uint256 public permissionedLiquidationThreshold;

  /// @notice Mapping from pool address to corresponding short allocation.
  mapping(address => uint256) public shortBorrowCapacityRatio;

  /*************
   * Modifiers *
   *************/

  modifier onlyRegisteredPool(address pool) {
    if (!pools.contains(pool)) revert ErrorPoolNotRegistered();
    _;
  }

  modifier onlyFxUSDSave() {
    if (_msgSender() != fxBASE) {
      // allow permissonless rebalance or liquidate when insufficient fxUSD/USDC in fxBASE.
      // we use total supply to estimate the amount of fxUSD/USDC in fxBASE.
      if (IERC20(fxBASE).totalSupply() >= permissionedLiquidationThreshold) {
        revert ErrorCallerNotFxUSDSave();
      }
    }
    _;
  }

  modifier onlyCounterparty() {
    if (counterparty != _msgSender()) {
      revert ErrorCallerNotCounterparty();
    }
    _;
  }

  modifier onlyTopLevelCall() {
    uint256 codesize = msg.sender.code.length;
    if (whitelist != address(0) && (codesize > 0 || msg.sender != tx.origin)) {
      if (!ISmartWalletChecker(whitelist).check(msg.sender)) {
        revert ErrorTopLevelCall();
      }
    }
    _;
  }

  modifier lock() {
    IPoolConfiguration(configuration).lock(address(this), msg.sig);
    _;
  }

  /***************
   * Constructor *
   ***************/

  constructor(address _fxUSD, address _fxBASE, address _counterparty, address _configuration, address _whitelist) {
    fxUSD = _fxUSD;
    fxBASE = _fxBASE;
    counterparty = _counterparty;
    configuration = _configuration;
    whitelist = _whitelist;
  }

  function initialize(
    address admin,
    uint256 _expenseRatio,
    uint256 _harvesterRatio,
    uint256 _flashLoanFeeRatio,
    address _treasury,
    address _revenuePool,
    address _reservePool
  ) external initializer {
    // comment out to reduce code size, since these functions are no-op for now.
    // __Context_init();
    // __AccessControl_init();
    // __ERC165_init();

    _grantRole(DEFAULT_ADMIN_ROLE, admin);

    __ProtocolFees_init(_expenseRatio, _harvesterRatio, _flashLoanFeeRatio, _treasury, _revenuePool, _reservePool);
    __FlashLoans_init();

    // default 10000 fxUSD
    // _updateThreshold(10000 ether);
  }

  /*
  function initializeV2(address pool) external onlyRegisteredPool(pool) reinitializer(2) {
    // fix state of pool
    address collateralToken = ILongPool(pool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);
    uint256 rawCollaterals = ILongPool(pool).getTotalRawCollaterals();
    uint256 collaterals = _scaleDown(rawCollaterals, scalingFactor);
    bytes32 data = poolInfo[pool].collateralData;
    data = data.insertUint(collaterals, COLLATERAL_BALANCE_OFFSET, COLLATERAL_DATA_BITS);
    poolInfo[pool].collateralData = data.insertUint(
      rawCollaterals,
      RAW_COLLATERAL_BALANCE_OFFSET,
      RAW_COLLATERAL_DATA_BITS
    );
  }
  */

  /*************************
   * Public View Functions *
   *************************/

  /// @notice Return the pool information.
  /// @param pool The address of pool to query.
  /// @return collateralCapacity The maximum allowed amount of collateral tokens.
  /// @return collateralBalance The amount of collateral tokens deposited.
  /// @return rawCollateral The amount of raw collateral tokens deposited.
  /// @return debtCapacity The maximum allowed amount of debt tokens.
  /// @return debtBalance The amount of debt tokens borrowed.
  function getPoolInfo(
    address pool
  )
    external
    view
    returns (
      uint256 collateralCapacity,
      uint256 collateralBalance,
      uint256 rawCollateral,
      uint256 debtCapacity,
      uint256 debtBalance
    )
  {
    bytes32 data = poolInfo[pool].collateralData;
    collateralCapacity = data.decodeUint(COLLATERAL_CAPACITY_OFFSET, COLLATERAL_DATA_BITS);
    collateralBalance = data.decodeUint(COLLATERAL_BALANCE_OFFSET, COLLATERAL_DATA_BITS);
    rawCollateral = data.decodeUint(RAW_COLLATERAL_BALANCE_OFFSET, RAW_COLLATERAL_DATA_BITS);
    data = poolInfo[pool].debtData;
    debtCapacity = data.decodeUint(DEBT_CAPACITY_OFFSET, DEBT_DATA_BITS);
    debtBalance = data.decodeUint(DEBT_BALANCE_OFFSET, DEBT_DATA_BITS);
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IPoolManager
  function operate(address pool, uint256 positionId, int256 newColl, int256 newDebt) external returns (uint256) {
    return operate(pool, positionId, newColl, newDebt, false);
  }

  /// @inheritdoc ILongPoolManager
  function operate(
    address pool,
    uint256 positionId,
    int256 newColl,
    int256 newDebt,
    bool useStable
  ) public onlyRegisteredPool(pool) nonReentrant whenNotPaused onlyTopLevelCall lock returns (uint256) {
    OperationMemoryVar memory vars;

    if (useStable) {
      if (!IPoolConfiguration(configuration).isStableRepayAllowed()) revert ErrorStableRepayNotAllowed();
      if (newColl > 0 || newDebt >= 0 || positionId == 0) revert ErrorInvalidOperation();
      vars.stablePrice = IFxUSDBasePool(fxBASE).getStableTokenPriceWithScale();
    }

    address collateralToken = ILongPool(pool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);

    (
      vars.poolSupplyFeeRatio,
      vars.poolWithdrawFeeRatio,
      vars.poolBorrowFeeRatio,
      vars.poolRepayFeeRatio
    ) = IPoolConfiguration(configuration).getPoolFeeRatio(pool, _msgSender());

    // in case of supply, we deduct the fee here first and transfer the collateral to pool.
    if (newColl > 0) {
      newColl = int256(_handleSupply(pool, collateralToken, uint256(newColl), vars.poolSupplyFeeRatio));
    }

    int256 newRawColl = newColl;
    int256 newRawDebt = newDebt;
    if (newRawColl != type(int256).min) {
      newRawColl = _scaleUp(newRawColl, scalingFactor);
    }
    if (useStable && newRawDebt != type(int256).min) {
      newRawDebt = _scaleUp(newRawDebt, vars.stablePrice);
    }

    // @dev the `protocolFees` is deprecated, it is always zero now.
    (positionId, newRawColl, newRawDebt, ) = ILongPool(pool).operate(positionId, newRawColl, newRawDebt, _msgSender());

    newColl = _scaleDown(newRawColl, scalingFactor);
    _changePoolDebts(pool, newRawDebt);
    if (newRawColl > 0) {
      _changePoolCollateral(pool, newColl, newRawColl);
    } else if (newRawColl < 0) {
      _handleWithdraw(pool, collateralToken, uint256(-newColl), uint256(-newRawColl), vars.poolWithdrawFeeRatio);
    }

    if (newRawDebt > 0) {
      _handleBorrow(uint256(newRawDebt), vars.poolBorrowFeeRatio);
    } else if (newRawDebt < 0) {
      _handleRepay(uint256(-newRawDebt), vars.poolRepayFeeRatio, vars.stablePrice);
    }

    emit Operate(pool, positionId, newColl, newRawDebt, 0);

    return positionId;
  }

  /// @inheritdoc IPoolManager
  function redeem(
    address pool,
    uint256 debts,
    uint256 minColls
  ) external onlyRegisteredPool(pool) nonReentrant whenNotPaused lock returns (uint256 actualDebts, uint256 colls) {
    if (debts > IERC20(fxUSD).balanceOf(_msgSender())) {
      revert ErrorRedeemExceedBalance();
    }
    if (debts < MIN_REDEEM_DEBTS) {
      revert ErrorRedeemDebtsTooSmall();
    }
    if (!IPoolConfiguration(configuration).isRedeemAllowed()) {
      revert ErrorRedeemNotAllowed();
    }

    uint256 rawColls;
    (actualDebts, rawColls) = ILongPool(pool).redeem(debts);
    debts = actualDebts;

    address collateralToken = ILongPool(pool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);
    colls = _scaleDown(rawColls, scalingFactor);

    _changePoolCollateral(pool, -int256(colls), -int256(rawColls));
    _changePoolDebts(pool, -int256(debts));

    // @dev use unchecked to reduce code size and gas
    uint256 protocolFees;
    unchecked {
      protocolFees = (colls * getRedeemFeeRatio()) / FEE_PRECISION;
      _accumulatePoolMiscFee(pool, protocolFees);
      colls -= protocolFees;
    }
    if (colls < minColls) revert ErrorInsufficientRedeemedCollateral();

    _transferCollateralOut(pool, collateralToken, colls, _msgSender());
    IFxUSDRegeneracy(fxUSD).burn(_msgSender(), debts);

    emit Redeem(pool, colls, debts, protocolFees);
  }

  /// @inheritdoc ILongPoolManager
  function rebalance(
    address pool,
    address receiver,
    int16 tick,
    uint256 maxFxUSD,
    uint256 maxStable
  )
    external
    onlyRegisteredPool(pool)
    nonReentrant
    whenNotPaused
    onlyFxUSDSave
    returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed)
  {
    LiquidateOrRebalanceMemoryVar memory op = _beforeRebalanceOrLiquidate(pool);
    // @dev use unchecked to reduce code size and gas
    unchecked {
      uint256 maxRawDebts = maxFxUSD + _scaleUp(maxStable, op.stablePrice);
      if (maxRawDebts < MIN_REBALANCE_DEBTS) {
        revert ErrorRebalanceDebtsTooSmall();
      }
      ILongPool.RebalanceResult memory result = ILongPool(pool).rebalance(tick, maxRawDebts);
      op.rawColls = result.rawColls + result.bonusRawColls;
      op.bonusRawColls = result.bonusRawColls;
      op.rawDebts = result.rawDebts;
    }
    (colls, fxUSDUsed, stableUsed) = _afterRebalanceOrLiquidate(pool, maxFxUSD, op, receiver);

    emit RebalanceTick(pool, tick, colls, fxUSDUsed, stableUsed);
  }

  /// @inheritdoc ILongPoolManager
  function rebalance(
    address pool,
    address receiver,
    uint256 maxFxUSD,
    uint256 maxStable
  )
    external
    onlyRegisteredPool(pool)
    nonReentrant
    whenNotPaused
    onlyFxUSDSave
    lock
    returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed)
  {
    LiquidateOrRebalanceMemoryVar memory op = _beforeRebalanceOrLiquidate(pool);
    // @dev use unchecked to reduce code size and gas
    unchecked {
      uint256 maxRawDebts = maxFxUSD + _scaleUp(maxStable, op.stablePrice);
      if (maxRawDebts < MIN_REBALANCE_DEBTS) {
        revert ErrorRebalanceDebtsTooSmall();
      }
      ILongPool.RebalanceResult memory result = ILongPool(pool).rebalance(maxRawDebts);
      op.rawColls = result.rawColls + result.bonusRawColls;
      op.bonusRawColls = result.bonusRawColls;
      op.rawDebts = result.rawDebts;
    }
    (colls, fxUSDUsed, stableUsed) = _afterRebalanceOrLiquidate(pool, maxFxUSD, op, receiver);

    emit Rebalance(pool, colls, fxUSDUsed, stableUsed);
  }

  /// @inheritdoc ILongPoolManager
  function liquidate(
    address pool,
    address receiver,
    uint256 maxFxUSD,
    uint256 maxStable
  )
    external
    onlyRegisteredPool(pool)
    nonReentrant
    whenNotPaused
    onlyFxUSDSave
    lock
    returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed)
  {
    LiquidateOrRebalanceMemoryVar memory op = _beforeRebalanceOrLiquidate(pool);
    uint256 maxRawDebts = maxFxUSD + _scaleUp(maxStable, op.stablePrice);
    if (maxRawDebts < MIN_LIQUIDATE_DEBTS) {
      revert ErrorLiquidateDebtsTooSmall();
    }
    {
      ILongPool.LiquidateResult memory result;
      uint256 reservedRawColls = IReservePool(reservePool).getBalance(op.collateralToken);
      reservedRawColls = _scaleUp(reservedRawColls, op.scalingFactor);

      // @dev use unchecked to reduce code size and gas
      unchecked {
        result = ILongPool(pool).liquidate(maxRawDebts, reservedRawColls);
        op.rawColls = result.rawColls + result.bonusRawColls;
        op.bonusRawColls = result.bonusRawColls;
        op.rawDebts = result.rawDebts;
      }

      // take bonus or shortfall from reserve pool
      uint256 bonusFromReserve = result.bonusFromReserve;
      if (bonusFromReserve > 0) {
        bonusFromReserve = _scaleDown(result.bonusFromReserve, op.scalingFactor);
        IReservePool(reservePool).requestBonus(ILongPool(pool).collateralToken(), address(this), bonusFromReserve);

        // increase pool reserve first
        _changePoolCollateral(pool, int256(bonusFromReserve), int256(result.bonusFromReserve));
      }
    }

    (colls, fxUSDUsed, stableUsed) = _afterRebalanceOrLiquidate(pool, maxFxUSD, op, receiver);

    emit Liquidate(pool, colls, fxUSDUsed, stableUsed);
  }

  /// @inheritdoc IPoolManager
  function harvest(
    address pool
  )
    external
    onlyRegisteredPool(pool)
    onlyRole(HARVESTER_ROLE)
    nonReentrant
    returns (uint256 amountRewards, uint256 amountFunding)
  {
    address collateralToken = ILongPool(pool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);

    uint256 collateralRecorded;
    uint256 rawCollateralRecorded;
    {
      bytes32 data = poolInfo[pool].collateralData;
      collateralRecorded = data.decodeUint(COLLATERAL_BALANCE_OFFSET, COLLATERAL_DATA_BITS);
      rawCollateralRecorded = data.decodeUint(RAW_COLLATERAL_BALANCE_OFFSET, RAW_COLLATERAL_DATA_BITS);
    }
    uint256 performanceFee;
    uint256 harvestBounty;
    // compute funding
    uint256 rawCollateral = ILongPool(pool).getTotalRawCollaterals();
    if (rawCollateralRecorded > rawCollateral) {
      unchecked {
        amountFunding = _scaleDown(rawCollateralRecorded - rawCollateral, scalingFactor);
        _changePoolCollateral(pool, -int256(amountFunding), -int256(rawCollateralRecorded - rawCollateral));

        performanceFee = (getFundingExpenseRatio() * amountFunding) / FEE_PRECISION;
        harvestBounty = (getHarvesterRatio() * amountFunding) / FEE_PRECISION;
        amountFunding -= harvestBounty + performanceFee;
      }
      _transferCollateralOut(
        pool,
        collateralToken,
        amountFunding,
        IPoolConfiguration(configuration).registry(POOL_FUNDING_TREASURY_KEY)
      );

      // recorded data changed, update local cache
      {
        bytes32 data = poolInfo[pool].collateralData;
        collateralRecorded = data.decodeUint(COLLATERAL_BALANCE_OFFSET, COLLATERAL_DATA_BITS);
        rawCollateralRecorded = data.decodeUint(RAW_COLLATERAL_BALANCE_OFFSET, RAW_COLLATERAL_DATA_BITS);
      }
    }
    // compute rewards
    rawCollateral = _scaleUp(collateralRecorded, scalingFactor);
    if (rawCollateral > rawCollateralRecorded) {
      unchecked {
        amountRewards = _scaleDown(rawCollateral - rawCollateralRecorded, scalingFactor);
        _changePoolCollateral(pool, -int256(amountRewards), 0);

        {
          uint256 performanceFeeRewards = (getRewardsExpenseRatio() * amountRewards) / FEE_PRECISION;
          uint256 harvestBountyRewards = (getHarvesterRatio() * amountRewards) / FEE_PRECISION;
          amountRewards -= harvestBountyRewards + performanceFeeRewards;
          performanceFee += performanceFeeRewards;
          harvestBounty += harvestBountyRewards;
        }

        _transferCollateralOut(
          pool,
          collateralToken,
          amountRewards,
          IPoolConfiguration(configuration).registry(POOL_REWARDS_TREASURY_KEY)
        );
      }
    }

    // transfer performance fee to treasury
    if (performanceFee > 0) {
      _transferCollateralOut(pool, collateralToken, performanceFee, treasury);
    }
    // transfer various fees to revenue pool
    _takeAccumulatedPoolFee(pool);
    // transfer harvest bounty
    if (harvestBounty > 0) {
      _transferCollateralOut(pool, collateralToken, harvestBounty, _msgSender());
    }
    emit Harvest(_msgSender(), pool, amountRewards, amountFunding, performanceFee, harvestBounty);
  }

  /// @inheritdoc ILongPoolManager
  function borrow(
    address longPool,
    address shortPool,
    uint256 amount
  ) external onlyCounterparty onlyRegisteredPool(longPool) nonReentrant {
    address creditNote = IShortPool(shortPool).creditNote();
    address collateralToken = ILongPool(longPool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);
    {
      uint256 rawCollateral = ILongPool(longPool).getTotalRawCollaterals();
      uint256 collateral = _scaleDown(rawCollateral, scalingFactor);
      uint256 borrowed = IERC20(creditNote).totalSupply();
      if ((collateral * shortBorrowCapacityRatio[longPool]) / PRECISION < borrowed + amount) {
        revert ErrorBorrowExceedCapacity();
      }
    }

    _transferOut(collateralToken, amount, counterparty);
    ICreditNote(creditNote).mint(address(this), amount);
  }

  /// @inheritdoc ILongPoolManager
  function repay(
    address longPool,
    address shortPool,
    uint256 amount
  ) external onlyCounterparty onlyRegisteredPool(longPool) nonReentrant {
    address collateralToken = ILongPool(longPool).collateralToken();
    _transferFrom(collateralToken, counterparty, address(this), amount);
    ICreditNote(IShortPool(shortPool).creditNote()).burn(address(this), amount);
  }

  /// @inheritdoc ILongPoolManager
  function repayByCreditNote(
    address longPool,
    address shortPool,
    uint256 amount
  ) external onlyCounterparty onlyRegisteredPool(longPool) nonReentrant {
    ICreditNote(IShortPool(shortPool).creditNote()).burn(counterparty, amount);
  }

  /// @inheritdoc ILongPoolManager
  function liquidateShortPool(
    address longPool,
    address shortPool,
    uint256 amountFxUSD,
    uint256 totalBorrowed
  ) external onlyCounterparty onlyRegisteredPool(longPool) nonReentrant returns (uint256 shortfall) {
    address collateralToken = ILongPool(longPool).collateralToken();
    uint256 scalingFactor = _getTokenScalingFactor(collateralToken);

    (, uint256 redeemedRawColls) = ILongPool(longPool).redeem(amountFxUSD);
    uint256 redeemedColls = _scaleDown(redeemedRawColls, scalingFactor);

    shortfall = totalBorrowed - redeemedColls;
    uint256 rawShortfall = _scaleUp(shortfall, scalingFactor);

    // reduce collateral in long pool
    ILongPool(longPool).reduceCollateral(rawShortfall);
    _changePoolCollateral(longPool, -int256(shortfall), -int256(rawShortfall));

    // burn fxUSD in short pool pool manager
    IFxUSDRegeneracy(fxUSD).burn(counterparty, amountFxUSD);

    // burn all credit note tokens in pool manager.
    // for tokens outside of pool manager, the short pool is killed, the tokens are useless.
    address creditNote = IShortPool(shortPool).creditNote();
    uint256 creditNoteAmount = IERC20(creditNote).balanceOf(address(this));
    if (creditNoteAmount > 0) {
      ICreditNote(creditNote).burn(address(this), creditNoteAmount);
    }
  }

  /// @inheritdoc IPoolManager
  /// @dev This is a risky operation, only allowed by whitelisted caller.
  function reduceDebt(
    address pool,
    uint256 amount
  ) external onlyRegisteredPool(pool) onlyRole(DEBT_REDUCER_ROLE) nonReentrant {
    IFxUSDRegeneracy(fxUSD).burn(_msgSender(), amount);
    ILongPool(pool).reduceDebt(amount);

    _changePoolDebts(pool, -int256(amount));

    emit ReduceDebt(pool, amount);
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Pause or unpause the system.
  /// @param status The pause status to update.
  function setPause(bool status) external onlyRole(EMERGENCY_ROLE) {
    if (status) _pause();
    else _unpause();
  }

  /// @notice Register a new pool with reward splitter.
  /// @param pool The address of pool.
  /// @param collateralCapacity The capacity for collateral token.
  /// @param debtCapacity The capacity for debt token.
  function registerPool(
    address pool,
    uint96 collateralCapacity,
    uint96 debtCapacity
  ) external onlyRole(DEFAULT_ADMIN_ROLE) {
    // @dev remove this line to reduce codesize, caller should make sure the pool is correct.
    // if (fxUSD != ILongPool(pool).fxUSD()) revert ErrorInvalidPool();

    if (pools.add(pool)) {
      emit RegisterPool(pool);

      _updatePoolCapacity(pool, collateralCapacity, debtCapacity);
    }
  }

  /// @notice Update rate provider for the given token.
  /// @param token The address of the token.
  /// @param provider The address of corresponding rate provider.
  function updateRateProvider(address token, address provider) external onlyRole(DEFAULT_ADMIN_ROLE) {
    uint256 scale = 10 ** (18 - IERC20Metadata(token).decimals());
    tokenRates[token] = TokenRate(uint96(scale), provider);

    emit UpdateTokenRate(token, scale, provider);
  }

  /// @notice Update the pool capacity.
  /// @param pool The address of fx pool.
  /// @param collateralCapacity The capacity for collateral token.
  /// @param debtCapacity The capacity for debt token.
  function updatePoolCapacity(
    address pool,
    uint96 collateralCapacity,
    uint96 debtCapacity
  ) external onlyRole(DEFAULT_ADMIN_ROLE) onlyRegisteredPool(pool) {
    _updatePoolCapacity(pool, collateralCapacity, debtCapacity);
  }

  /// @notice Update threshold for permissionless liquidation.
  /// @param newThreshold The value of new threshold.
  function updateThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateThreshold(newThreshold);
  }

  /// @notice Update the short borrow capacity ratio for the given long pool.
  /// @param longPool The address of the long pool.
  /// @param newRatio The new short borrow capacity ratio.
  function updateShortBorrowCapacityRatio(address longPool, uint256 newRatio) external onlyRole(DEFAULT_ADMIN_ROLE) {
    uint256 oldRatio = shortBorrowCapacityRatio[longPool];
    shortBorrowCapacityRatio[longPool] = newRatio;

    emit UpdateShortBorrowCapacityRatio(longPool, oldRatio, newRatio);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @inheritdoc ProtocolFees
  function _takeAccumulatedPoolFee(address pool) internal virtual override {
    address collateralToken = ILongPool(pool).collateralToken();
    uint256 fees = accumulatedPoolOpenFees[pool];
    if (fees > 0) {
      _transferCollateralOut(pool, collateralToken, fees, openRevenuePool);
      accumulatedPoolOpenFees[pool] = 0;
    }
    fees = accumulatedPoolCloseFees[pool];
    if (fees > 0) {
      _transferCollateralOut(pool, collateralToken, fees, closeRevenuePool);
      accumulatedPoolCloseFees[pool] = 0;
    }
    fees = accumulatedPoolMiscFees[pool];
    if (fees > 0) {
      _transferCollateralOut(pool, collateralToken, fees, miscRevenuePool);
      accumulatedPoolMiscFees[pool] = 0;
    }
  }

  /// @dev Internal function to update the pool capacity.
  /// @param pool The address of fx pool.
  /// @param collateralCapacity The capacity for collateral token.
  /// @param debtCapacity The capacity for debt token.
  function _updatePoolCapacity(address pool, uint96 collateralCapacity, uint96 debtCapacity) internal {
    poolInfo[pool].collateralData = poolInfo[pool].collateralData.insertUint(
      collateralCapacity,
      COLLATERAL_CAPACITY_OFFSET,
      COLLATERAL_DATA_BITS
    );
    poolInfo[pool].debtData = poolInfo[pool].debtData.insertUint(debtCapacity, DEBT_CAPACITY_OFFSET, DEBT_DATA_BITS);

    emit UpdatePoolCapacity(pool, collateralCapacity, debtCapacity);
  }

  /// @dev Internal function to update threshold for permissionless liquidation.
  /// @param newThreshold The value of new threshold.
  function _updateThreshold(uint256 newThreshold) internal {
    uint256 oldThreshold = permissionedLiquidationThreshold;
    permissionedLiquidationThreshold = newThreshold;

    emit UpdatePermissionedLiquidationThreshold(oldThreshold, newThreshold);
  }

  /// @dev Internal function to scaler up for `uint256`.
  function _scaleUp(uint256 value, uint256 scale) internal pure returns (uint256) {
    return (value * scale) / PRECISION;
  }

  /// @dev Internal function to scaler up for `int256`.
  function _scaleUp(int256 value, uint256 scale) internal pure returns (int256) {
    return (value * int256(scale)) / PRECISION_I256;
  }

  /// @dev Internal function to scaler down for `uint256`, rounding down.
  function _scaleDown(uint256 value, uint256 scale) internal pure returns (uint256) {
    return (value * PRECISION) / scale;
  }

  /// @dev Internal function to scaler down for `uint256`, rounding up.
  function _scaleDownRoundingUp(uint256 value, uint256 scale) internal pure returns (uint256) {
    return (value * PRECISION + scale - 1) / scale;
  }

  /// @dev Internal function to scaler down for `int256`.
  function _scaleDown(int256 value, uint256 scale) internal pure returns (int256) {
    return (value * PRECISION_I256) / int256(scale);
  }

  /// @dev Internal function to handle supply.
  /// @param pool The address of pool.
  /// @param collateralToken The address of collateral token.
  /// @param newColl The amount of collateral token supplied.
  /// @param poolFeeRatio The pool supply fee ratio, multiplied by 10^9.
  /// @return newColl The amount of collateral token supplied after fees.
  function _handleSupply(
    address pool,
    address collateralToken,
    uint256 newColl,
    uint256 poolFeeRatio
  ) internal returns (uint256) {
    // handle supply fee for protocol and referral, it is safe to use unchecked here
    unchecked {
      uint256 poolFee = (newColl * poolFeeRatio) / FEE_PRECISION;
      _accumulatePoolOpenFee(pool, poolFee);
      _transferFrom(collateralToken, _msgSender(), address(this), newColl);
      return newColl - poolFee;
    }
  }

  /// @dev Internal function to handle withdraw.
  /// @param pool The address of pool.
  /// @param collateralToken The address of collateral token.
  /// @param newColl The amount of collateral token withdrawn.
  /// @param newRawColl The amount of raw collateral token withdrawn.
  /// @param poolFeeRatio The pool withdraw fee ratio, multiplied by 10^9.
  function _handleWithdraw(
    address pool,
    address collateralToken,
    uint256 newColl,
    uint256 newRawColl,
    uint256 poolFeeRatio
  ) internal {
    _changePoolCollateral(pool, -int256(newColl), -int256(newRawColl));

    // handle withdraw fee for protocol and referral, it is safe to use unchecked here
    unchecked {
      uint256 poolFee = (newColl * poolFeeRatio) / FEE_PRECISION;
      if (poolFee > 0) {
        _accumulatePoolCloseFee(pool, poolFee);
      }
      _transferCollateralOut(pool, collateralToken, newColl - poolFee, _msgSender());
    }
  }

  /// @dev Internal function to handle borrow.
  /// @param newDebt The amount of fxUSD borrowed.
  /// @param poolFeeRatio The pool borrow fee ratio, multiplied by 10^9.
  function _handleBorrow(uint256 newDebt, uint256 poolFeeRatio) internal {
    // handle borrow fee for protocol and referral, it is safe to use unchecked here
    unchecked {
      uint256 poolFee = (newDebt * poolFeeRatio) / FEE_PRECISION;
      if (poolFee > 0) {
        IFxUSDRegeneracy(fxUSD).mint(openRevenuePool, poolFee);
      }
      IFxUSDRegeneracy(fxUSD).mint(_msgSender(), newDebt - poolFee);
    }
  }

  /// @dev Internal function to handle repay.
  /// @param newRawDebt The amount of fxUSD repaid.
  /// @param poolFeeRatio The pool repay fee ratio, multiplied by 10^9.
  function _handleRepay(uint256 newRawDebt, uint256 poolFeeRatio, uint256 stablePrice) internal {
    uint256 newDebt = newRawDebt;
    if (stablePrice != 0) {
      newDebt = _scaleDown(newRawDebt, stablePrice);
    }
    // handle repay fee for protocol and referral, it is safe to use unchecked here
    unchecked {
      uint256 poolFee = (newDebt * poolFeeRatio) / FEE_PRECISION;
      if (stablePrice == 0) {
        if (poolFee > 0) {
          IFxUSDRegeneracy(fxUSD).mint(closeRevenuePool, poolFee);
        }
        IFxUSDRegeneracy(fxUSD).burn(_msgSender(), newDebt + poolFee);
      } else {
        address stableToken = IFxUSDBasePool(fxBASE).stableToken();
        _transferFrom(stableToken, _msgSender(), closeRevenuePool, poolFee);
        _transferFrom(stableToken, _msgSender(), fxUSD, newDebt);
        IFxUSDRegeneracy(fxUSD).onRebalanceWithStable(newDebt, newRawDebt);
      }
    }
  }

  /// @dev Internal function to prepare variables before rebalance or liquidate.
  /// @param pool The address of pool to liquidate or rebalance.
  function _beforeRebalanceOrLiquidate(address pool) internal view returns (LiquidateOrRebalanceMemoryVar memory op) {
    op.stablePrice = IFxUSDBasePool(fxBASE).getStableTokenPriceWithScale();
    op.collateralToken = ILongPool(pool).collateralToken();
    op.scalingFactor = _getTokenScalingFactor(op.collateralToken);
  }

  /// @dev Internal function to do actions after rebalance or liquidate.
  /// @param pool The address of pool to liquidate or rebalance.
  /// @param maxFxUSD The maximum amount of fxUSD can be used.
  /// @param op The memory helper variable.
  /// @param receiver The address collateral token receiver.
  /// @return colls The actual amount of collateral token rebalanced or liquidated.
  /// @return fxUSDUsed The amount of fxUSD used.
  /// @return stableUsed The amount of stable token (a.k.a USDC) used.
  function _afterRebalanceOrLiquidate(
    address pool,
    uint256 maxFxUSD,
    LiquidateOrRebalanceMemoryVar memory op,
    address receiver
  ) internal returns (uint256 colls, uint256 fxUSDUsed, uint256 stableUsed) {
    colls = _scaleDown(op.rawColls, op.scalingFactor);
    _changePoolCollateral(pool, -int256(colls), -int256(op.rawColls));
    _changePoolDebts(pool, -int256(op.rawDebts));

    // burn fxUSD or transfer USDC
    fxUSDUsed = op.rawDebts;
    if (fxUSDUsed > maxFxUSD) {
      // rounding up here
      stableUsed = _scaleDownRoundingUp(fxUSDUsed - maxFxUSD, op.stablePrice);
      fxUSDUsed = maxFxUSD;
    }
    if (fxUSDUsed > 0) {
      IFxUSDRegeneracy(fxUSD).burn(_msgSender(), fxUSDUsed);
    }
    if (stableUsed > 0) {
      if (!IPoolConfiguration(configuration).isStableRepayAllowed()) revert ErrorStableRepayNotAllowed();
      _transferFrom(IFxUSDBasePool(fxBASE).stableToken(), _msgSender(), fxUSD, stableUsed);
      IFxUSDRegeneracy(fxUSD).onRebalanceWithStable(stableUsed, op.rawDebts - maxFxUSD);
    }

    // transfer collateral
    uint256 protocolRevenue = (_scaleDown(op.bonusRawColls, op.scalingFactor) * getLiquidationExpenseRatio()) /
      FEE_PRECISION;
    _accumulatePoolMiscFee(pool, protocolRevenue);
    unchecked {
      colls -= protocolRevenue;
    }
    _transferCollateralOut(pool, op.collateralToken, colls, receiver);
  }

  /// @dev Internal function to update collateral balance.
  function _changePoolCollateral(address pool, int256 delta, int256 rawDelta) internal {
    bytes32 data = poolInfo[pool].collateralData;
    uint256 capacity = data.decodeUint(COLLATERAL_CAPACITY_OFFSET, COLLATERAL_DATA_BITS);
    uint256 balance = uint256(int256(data.decodeUint(COLLATERAL_BALANCE_OFFSET, COLLATERAL_DATA_BITS)) + delta);
    if (balance > capacity) revert ErrorCollateralExceedCapacity();
    data = data.insertUint(balance, COLLATERAL_BALANCE_OFFSET, COLLATERAL_DATA_BITS);
    balance = uint256(int256(data.decodeUint(RAW_COLLATERAL_BALANCE_OFFSET, RAW_COLLATERAL_DATA_BITS)) + rawDelta);
    poolInfo[pool].collateralData = data.insertUint(balance, RAW_COLLATERAL_BALANCE_OFFSET, RAW_COLLATERAL_DATA_BITS);
  }

  /// @dev Internal function to update debt balance.
  function _changePoolDebts(address pool, int256 delta) internal {
    bytes32 data = poolInfo[pool].debtData;
    uint256 capacity = data.decodeUint(DEBT_CAPACITY_OFFSET, DEBT_DATA_BITS);
    uint256 balance = uint256(int256(data.decodeUint(DEBT_BALANCE_OFFSET, DEBT_DATA_BITS)) + delta);
    if (balance > capacity) revert ErrorDebtExceedCapacity();
    poolInfo[pool].debtData = data.insertUint(balance, DEBT_BALANCE_OFFSET, DEBT_DATA_BITS);
  }

  /// @dev Internal function to get token scaling factor.
  function _getTokenScalingFactor(address token) internal view returns (uint256 value) {
    address rateProvider = tokenRates[token].rateProvider;
    value = tokenRates[token].scalar;
    unchecked {
      if (rateProvider != address(0)) {
        value *= IRateProvider(rateProvider).getRate();
      } else {
        value *= PRECISION;
      }
    }
  }

  /// @dev Internal function to get pool collateral info.
  /// @param pool The address of pool.
  /// @return collateralCapacity The capacity for collateral token.
  /// @return collateralBalance The balance for collateral token.
  /// @return rawCollateral The raw collateral balance for collateral token.
  function _getPoolCollateralInfo(
    address pool
  ) internal view returns (uint256 collateralCapacity, uint256 collateralBalance, uint256 rawCollateral) {
    bytes32 data = poolInfo[pool].collateralData;
    collateralCapacity = data.decodeUint(COLLATERAL_CAPACITY_OFFSET, COLLATERAL_DATA_BITS);
    collateralBalance = data.decodeUint(COLLATERAL_BALANCE_OFFSET, COLLATERAL_DATA_BITS);
    rawCollateral = data.decodeUint(RAW_COLLATERAL_BALANCE_OFFSET, RAW_COLLATERAL_DATA_BITS);
  }

  /// @dev Internal function to transfer collateral out.
  /// @param pool The address of pool.
  /// @param collateralToken The address of collateral token.
  /// @param scaledAmount The scaled amount of collateral token.
  /// @param receiver The address of receiver.
  function _transferCollateralOut(
    address pool,
    address collateralToken,
    uint256 scaledAmount,
    address receiver
  ) internal {
    address shortPool = ILongPool(pool).counterparty();
    // check if current collateral is enough, if not use debt token to cover
    if (shortPool != address(0)) {
      uint256 balance = _balanceOf(collateralToken);
      if (scaledAmount <= balance) {
        _transferOut(collateralToken, scaledAmount, receiver);
      } else {
        address creditNote = IShortPool(shortPool).creditNote();
        uint256 shortfall = scaledAmount - balance;
        IERC20(creditNote).safeTransfer(receiver, shortfall);
        _transferOut(collateralToken, balance, receiver);
      }
    } else {
      _transferOut(collateralToken, scaledAmount, receiver);
    }
  }

  /// @dev Internal function to transfer token from `msg.sender` to receiver.
  /// @param token The address of token.
  /// @param sender The address of sender.
  /// @param receiver The address of receiver.
  /// @param amount The amount of token.
  function _transferFrom(address token, address sender, address receiver, uint256 amount) internal {
    if (amount > 0) {
      IERC20(token).safeTransferFrom(sender, receiver, amount);
    }
  }
}
