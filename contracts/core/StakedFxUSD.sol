// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable-v4/access/AccessControlUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable-v4/security/ReentrancyGuardUpgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import { IERC20MetadataUpgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/IERC20Upgradeable.sol";

import { AggregatorV3Interface } from "../interfaces/Chainlink/AggregatorV3Interface.sol";
import { IPegKeeper } from "../interfaces/IPegKeeper.sol";
import { IPool } from "../interfaces/IPool.sol";
import { IPoolManager } from "../interfaces/IPoolManager.sol";
import { IStakedFxUSD } from "../interfaces/IStakedFxUSD.sol";

import { LinearRewardDistributor } from "../common/rewards/distributor/LinearRewardDistributor.sol";

contract StakedFxUSD is
  AccessControlUpgradeable,
  ERC20PermitUpgradeable,
  ReentrancyGuardUpgradeable,
  LinearRewardDistributor,
  IStakedFxUSD
{
  using SafeERC20Upgradeable for IERC20Upgradeable;

  /**********
   * Errors *
   **********/

  /// @dev Thrown when the deposited amount is zero.
  error ErrDepositZeroAmount();

  /// @dev Thrown when the pool has been liquidated and not rebalanced.
  error ErrHasLiquidation();

  /// @dev Thrown when the minted shares are not enough.
  error ErrInsufficientSharesOut();

  /// @dev Thrown when the redeemed tokens are not enough.
  error ErrInsufficientTokensOut();

  /// @dev Thrown the input token in invalid.
  error ErrInvalidTokenIn();

  /// @dev Thrown the output token in invalid.
  error ErrInvalidTokenOut();

  /// @dev Thrown when the redeemed shares is zero.
  error ErrRedeemZeroShares();

  /// @dev Thrown when the caller is not `FxOmniVault` contract.
  error ErrorCallerIsNotVault();

  /// @dev Thrown when the caller is not `FxTransformer` contract.
  error ErrorCallerIsNotTransformer();

  /*************
   * Constants *
   *************/

  /// @dev The exchange rate precision.
  uint256 internal constant PRECISION = 1e18;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The address of `PoolManager` contract.
  address public immutable poolManager;

  /// @notice The address of `PegKeeper` contract.
  address public immutable pegKeeper;

  /// @inheritdoc IStakedFxUSD
  /// @dev This is also the address of FxUSD token.
  address public immutable yieldToken;

  /// @inheritdoc IStakedFxUSD
  /// @dev The address of USDC token.
  address public immutable stableToken;

  uint256 private immutable stableTokenScale;

  /// @notice The Chainlink USDC/USD price feed.
  /// @dev The encoding is below.
  /// ```text
  /// |  32 bits  | 64 bits |  160 bits  |
  /// | heartbeat |  scale  | price_feed |
  /// |low                          high |
  /// ```
  bytes32 public immutable Chainlink_USDC_USD_Spot;

  /***********
   * Structs *
   ***********/

  struct RebalanceMemoryVar {
    uint256 stablePrice;
    uint256 totalYieldToken;
    uint256 totalStableToken;
    uint256 yieldTokenToUse;
    uint256 stableTokenToUse;
    uint256 colls;
    uint256 yieldTokenUsed;
    uint256 stableTokenUsed;
  }

  /*************
   * Variables *
   *************/

  /// @inheritdoc IStakedFxUSD
  uint256 public totalYieldToken;

  /// @inheritdoc IStakedFxUSD
  uint256 public totalStableToken;

  uint256 public stableDepegPrice;

  /// @dev reserved slots.
  uint256[50] private __gap;

  /*************
   * Modifiers *
   *************/

  modifier onlyValidToken(address token) {
    if (token != stableToken && token != yieldToken) {
      revert ErrInvalidTokenIn();
    }
    _;
  }

  modifier onlyPegKeeper() {
    if (_msgSender() != pegKeeper) revert();
    _;
  }

  /***************
   * Constructor *
   ***************/

  constructor(
    address _poolManager,
    address _pegKeeper,
    address _yieldToken,
    address _stableToken,
    bytes32 _Chainlink_USDC_USD_Spot
  ) LinearRewardDistributor(1 weeks) {
    poolManager = _poolManager;
    pegKeeper = _pegKeeper;
    yieldToken = _yieldToken;
    stableToken = _stableToken;
    Chainlink_USDC_USD_Spot = _Chainlink_USDC_USD_Spot;

    stableTokenScale = 10 ** (18 - IERC20MetadataUpgradeable(_stableToken).decimals());
  }

  function initialize(string memory _name, string memory _symbol, uint256 _stableDepegPrice) external initializer {
    __Context_init();
    __ERC165_init();
    __AccessControl_init();
    __ReentrancyGuard_init();

    __ERC20_init(_name, _symbol);
    __ERC20Permit_init(_name);

    __LinearRewardDistributor_init(yieldToken);

    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());

    _updateStableDepegPrice(_stableDepegPrice);
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc IStakedFxUSD
  function previewDeposit(
    address tokenIn,
    uint256 amountTokenToDeposit
  ) public view override onlyValidToken(tokenIn) returns (uint256 amountSharesOut) {
    uint256 price = getStableTokenPriceWithScale();
    uint256 amountUSD = amountTokenToDeposit;
    if (tokenIn == stableToken) {
      amountUSD = (amountUSD * price) / PRECISION;
    }

    uint256 _totalSupply = totalSupply();
    if (_totalSupply == 0) {
      amountSharesOut = amountUSD;
    } else {
      uint256 totalUSD = totalYieldToken + (totalStableToken * price) / PRECISION;
      amountSharesOut = (amountUSD * _totalSupply) / totalUSD;
    }
  }

  /// @inheritdoc IStakedFxUSD
  function previewRedeem(
    uint256 amountSharesToRedeem
  ) external view returns (uint256 amountYieldOut, uint256 amountStableOut) {
    uint256 cachedTotalYieldToken = totalYieldToken;
    uint256 cachedTotalStableToken = totalStableToken;
    uint256 cachedTotalSupply = totalSupply();
    amountYieldOut = (amountSharesToRedeem * cachedTotalYieldToken) / cachedTotalSupply;
    amountStableOut = (amountSharesToRedeem * cachedTotalStableToken) / cachedTotalSupply;
  }

  /// @inheritdoc IStakedFxUSD
  function nav() external view returns (uint256) {
    uint256 _totalSupply = totalSupply();
    if (_totalSupply == 0) {
      return PRECISION;
    } else {
      uint256 price = getStableTokenPriceWithScale();
      uint256 totalUSD = totalYieldToken + (totalStableToken * price) / PRECISION;
      return (totalUSD * PRECISION) / _totalSupply;
    }
  }

  /// @inheritdoc IStakedFxUSD
  function getStableTokenPrice() public view returns (uint256) {
    bytes32 encoding = Chainlink_USDC_USD_Spot;
    address aggregator;
    uint256 scale;
    uint256 heartbeat;
    assembly {
      aggregator := shr(96, encoding)
      scale := and(shr(32, encoding), 0xffffffffffffffff)
      heartbeat := and(encoding, 0xffffffff)
    }
    (, int256 answer, , uint256 updatedAt, ) = AggregatorV3Interface(aggregator).latestRoundData();
    if (answer < 0) revert("invalid");
    if (block.timestamp - updatedAt > heartbeat) revert("expired");
    return uint256(answer) * scale;
  }

  /// @inheritdoc IStakedFxUSD
  function getStableTokenPriceWithScale() public view returns (uint256) {
    return getStableTokenPrice() * stableTokenScale;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IStakedFxUSD
  function deposit(
    address receiver,
    address tokenIn,
    uint256 amountTokenToDeposit,
    uint256 minSharesOut
  ) external override nonReentrant onlyValidToken(tokenIn) returns (uint256 amountSharesOut) {
    _distributePendingReward();

    if (amountTokenToDeposit == 0) revert ErrDepositZeroAmount();

    // we are very sure every token is normal token, so no fot check here.
    IERC20Upgradeable(tokenIn).safeTransferFrom(_msgSender(), address(this), amountTokenToDeposit);

    amountSharesOut = _deposit(tokenIn, amountTokenToDeposit);
    if (amountSharesOut < minSharesOut) revert ErrInsufficientSharesOut();

    _mint(receiver, amountSharesOut);

    emit Deposit(_msgSender(), receiver, tokenIn, amountTokenToDeposit, amountSharesOut);
  }

  /// @inheritdoc IStakedFxUSD
  function redeem(
    address receiver,
    uint256 amountSharesToRedeem
  ) external nonReentrant returns (uint256 amountYieldOut, uint256 amountStableOut) {
    _distributePendingReward();

    uint256 cachedTotalYieldToken = totalYieldToken;
    uint256 cachedTotalStableToken = totalStableToken;
    uint256 cachedTotalSupply = totalSupply();

    amountYieldOut = (amountSharesToRedeem * cachedTotalYieldToken) / cachedTotalSupply;
    amountStableOut = (amountSharesToRedeem * cachedTotalStableToken) / cachedTotalSupply;

    _burn(_msgSender(), amountSharesToRedeem);

    if (amountYieldOut > 0) {
      IERC20Upgradeable(yieldToken).safeTransfer(receiver, amountYieldOut);
      unchecked {
        totalYieldToken = cachedTotalYieldToken - amountYieldOut;
      }
    }
    if (amountStableOut > 0) {
      IERC20Upgradeable(stableToken).safeTransfer(receiver, amountStableOut);
      unchecked {
        totalStableToken = cachedTotalStableToken - amountStableOut;
      }
    }

    emit Redeem(_msgSender(), receiver, amountSharesToRedeem, amountYieldOut, amountStableOut);
  }

  /// @inheritdoc IStakedFxUSD
  function rebalance(
    address pool,
    int16 tickId,
    address tokenIn,
    uint256 maxAmount,
    uint256 minCollOut
  ) external onlyValidToken(tokenIn) nonReentrant returns (uint256 tokenUsed, uint256 colls) {
    RebalanceMemoryVar memory op;
    _beforeRebalanceOrLiquidate(tokenIn, maxAmount, op);
    (op.colls, op.yieldTokenUsed, op.stableTokenUsed) = IPoolManager(poolManager).rebalance(
      pool,
      _msgSender(),
      tickId,
      op.yieldTokenToUse,
      op.stableTokenToUse
    );
    tokenUsed = _afterRebalanceOrLiquidate(tokenIn, minCollOut, op);
    colls = op.colls;
  }

  /// @inheritdoc IStakedFxUSD
  function rebalance(
    address pool,
    uint32 positionId,
    address tokenIn,
    uint256 maxAmount,
    uint256 minCollOut
  ) external onlyValidToken(tokenIn) nonReentrant returns (uint256 tokenUsed, uint256 colls) {
    RebalanceMemoryVar memory op;
    _beforeRebalanceOrLiquidate(tokenIn, maxAmount, op);
    (op.colls, op.yieldTokenUsed, op.stableTokenUsed) = IPoolManager(poolManager).rebalance(
      pool,
      _msgSender(),
      positionId,
      op.yieldTokenToUse,
      op.stableTokenToUse
    );
    tokenUsed = _afterRebalanceOrLiquidate(tokenIn, minCollOut, op);
    colls = op.colls;
  }

  /// @inheritdoc IStakedFxUSD
  function liquidate(
    address pool,
    uint32 positionId,
    address tokenIn,
    uint256 maxAmount,
    uint256 minCollOut
  ) external onlyValidToken(tokenIn) nonReentrant returns (uint256 tokenUsed, uint256 colls) {
    RebalanceMemoryVar memory op;
    _beforeRebalanceOrLiquidate(tokenIn, maxAmount, op);
    (op.colls, op.yieldTokenUsed, op.stableTokenUsed) = IPoolManager(poolManager).liquidate(
      pool,
      _msgSender(),
      positionId,
      op.yieldTokenToUse,
      op.stableTokenToUse
    );
    tokenUsed = _afterRebalanceOrLiquidate(tokenIn, minCollOut, op);
    colls = op.colls;
  }

  function arbitrage(
    address srcToken,
    uint256 amountIn,
    address receiver,
    bytes calldata data
  ) external onlyValidToken(srcToken) onlyPegKeeper nonReentrant returns (uint256 amountOut, uint256 bonusOut) {
    address dstToken;
    uint256 expectedOut;
    uint256 cachedTotalYieldToken = totalYieldToken;
    uint256 cachedTotalStableToken = totalStableToken;
    {
      uint256 price = getStableTokenPrice();
      uint256 scaledPrice = price * stableTokenScale;
      if (srcToken == yieldToken) {
        // check if usdc depeg
        if (price < stableDepegPrice) revert();
        if (amountIn > cachedTotalYieldToken) revert();
        dstToken = stableToken;
        unchecked {
          // rounding up
          expectedOut = (amountIn * PRECISION) / scaledPrice + 1;
          cachedTotalYieldToken -= amountIn;
          cachedTotalStableToken += expectedOut;
        }
      } else {
        if (amountIn > cachedTotalStableToken) revert();
        dstToken = yieldToken;
        unchecked {
          // rounding up
          expectedOut = (amountIn * scaledPrice) / PRECISION + 1;
          cachedTotalStableToken -= amountIn;
          cachedTotalYieldToken += expectedOut;
        }
      }
    }
    uint256 actualOut = IERC20Upgradeable(dstToken).balanceOf(address(this));
    amountOut = IPegKeeper(pegKeeper).onSwap(stableToken, dstToken, amountIn, data);
    actualOut = IERC20Upgradeable(dstToken).balanceOf(address(this)) - actualOut;
    // check actual fxUSD swapped in case peg keeper is hacked.
    if (amountOut > actualOut) revert();
    // check swapped token has no loss
    if (amountOut < expectedOut) revert();

    totalYieldToken = cachedTotalYieldToken;
    totalStableToken = cachedTotalStableToken;
    bonusOut = amountOut - expectedOut;
    if (bonusOut > 0) {
      IERC20Upgradeable(dstToken).safeTransfer(receiver, bonusOut);
    }
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @inheritdoc LinearRewardDistributor
  function _accumulateReward(uint256 _amount) internal virtual override {
    if (_amount == 0) return;

    unchecked {
      totalYieldToken += _amount;
    }
  }

  function _updateStableDepegPrice(uint256 _newPrice) internal {
    stableDepegPrice = _newPrice;
    // todo emit event
  }

  /// @dev mint shares based on the deposited base tokens
  /// @param tokenIn base token address used to mint shares
  /// @param amountDeposited amount of base tokens deposited
  /// @return amountSharesOut amount of shares minted
  function _deposit(address tokenIn, uint256 amountDeposited) internal virtual returns (uint256 amountSharesOut) {
    uint256 price = getStableTokenPriceWithScale();
    uint256 amountUSD = amountDeposited;
    if (tokenIn == stableToken) {
      amountUSD = (amountUSD * price) / PRECISION;
    }

    uint256 cachedTotalYieldToken = totalYieldToken;
    uint256 cachedTotalStableToken = totalStableToken;
    uint256 totalUSD = cachedTotalYieldToken + (cachedTotalStableToken * price) / PRECISION;
    uint256 cachedTotalSupply = totalSupply();
    if (cachedTotalSupply == 0) {
      amountSharesOut = amountUSD;
    } else {
      amountSharesOut = (amountUSD * cachedTotalSupply) / totalUSD;
    }

    if (tokenIn == stableToken) {
      totalStableToken = cachedTotalStableToken + amountDeposited;
    } else {
      totalYieldToken = cachedTotalYieldToken + amountDeposited;
    }
  }

  function _beforeRebalanceOrLiquidate(address tokenIn, uint256 maxAmount, RebalanceMemoryVar memory op) internal view {
    op.stablePrice = getStableTokenPriceWithScale();
    op.totalYieldToken = totalYieldToken;
    op.totalStableToken = totalStableToken;

    uint256 amountYieldToken = op.totalYieldToken;
    uint256 amountStableToken;
    // we always, try use fxUSD first then USDC
    if (tokenIn == yieldToken) {
      // user pays fxUSD
      if (maxAmount < amountYieldToken) amountYieldToken = maxAmount;
      else {
        amountStableToken = ((maxAmount - amountYieldToken) * PRECISION) / op.stablePrice;
      }
    } else {
      // user pays USDC
      uint256 maxAmountInUSD = (maxAmount * op.stablePrice) / PRECISION;
      if (maxAmountInUSD < amountYieldToken) amountYieldToken = maxAmount;
      else {
        amountStableToken = ((maxAmountInUSD - amountYieldToken) * PRECISION) / op.stablePrice;
      }
    }

    if (amountStableToken > op.totalStableToken) {
      amountStableToken = op.totalStableToken;
    }

    op.yieldTokenToUse = amountYieldToken;
    op.stableTokenToUse = amountStableToken;
  }

  function _afterRebalanceOrLiquidate(
    address tokenIn,
    uint256 minCollOut,
    RebalanceMemoryVar memory op
  ) internal returns (uint256 tokenUsed) {
    if (op.colls < minCollOut) revert();

    op.totalYieldToken -= op.yieldTokenUsed;
    op.totalStableToken -= op.stableTokenUsed;

    uint256 amountUSD = op.yieldTokenUsed + (op.stableTokenUsed * op.stablePrice) / PRECISION;
    if (tokenIn == yieldToken) {
      tokenUsed = amountUSD;
      op.totalYieldToken += tokenUsed;
    } else {
      // rounding up
      tokenUsed = (amountUSD * PRECISION) / op.stablePrice + 1;
      op.totalStableToken += tokenUsed;
    }

    // transfer token from caller, the collateral is already transferred to caller.
    IERC20Upgradeable(tokenIn).safeTransferFrom(_msgSender(), address(this), tokenUsed);
  }
}
