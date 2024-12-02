// SPDX-License-Identifier: MIT

pragma solidity ^0.8.25;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import { AggregatorV3Interface } from "../interfaces/Chainlink/AggregatorV3Interface.sol";
import { IPegKeeper } from "../interfaces/IPegKeeper.sol";
import { IPool } from "../interfaces/IPool.sol";
import { IPoolManager } from "../interfaces/IPoolManager.sol";
import { IFxUSDBasePool } from "../interfaces/IFxUSDBasePool.sol";

import { Math } from "../libraries/Math.sol";

contract FxUSDBasePool is ERC20PermitUpgradeable, AccessControlUpgradeable, ReentrancyGuardUpgradeable, IFxUSDBasePool {
  using SafeERC20 for IERC20;

  /**********
   * Errors *
   **********/

  /// @dev Thrown when the deposited amount is zero.
  error ErrDepositZeroAmount();

  /// @dev Thrown when the minted shares are not enough.
  error ErrInsufficientSharesOut();

  /// @dev Thrown the input token in invalid.
  error ErrInvalidTokenIn();

  /// @dev Thrown when the redeemed shares is zero.
  error ErrRedeemZeroShares();

  error ErrorCallerNotPegKeeper();

  error ErrorStableTokenDepeg();

  error ErrorSwapExceedBalance();

  error ErrorInsufficientOutput();

  error ErrorInsufficientArbitrage();

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

  /// @inheritdoc IFxUSDBasePool
  /// @dev This is also the address of FxUSD token.
  address public immutable yieldToken;

  /// @inheritdoc IFxUSDBasePool
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

  /// @inheritdoc IFxUSDBasePool
  uint256 public totalYieldToken;

  /// @inheritdoc IFxUSDBasePool
  uint256 public totalStableToken;

  /// @notice The depeg price for stable token.
  uint256 public stableDepegPrice;

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
    if (_msgSender() != pegKeeper) revert ErrorCallerNotPegKeeper();
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
  ) {
    poolManager = _poolManager;
    pegKeeper = _pegKeeper;
    yieldToken = _yieldToken;
    stableToken = _stableToken;
    Chainlink_USDC_USD_Spot = _Chainlink_USDC_USD_Spot;

    stableTokenScale = 10 ** (18 - IERC20Metadata(_stableToken).decimals());
  }

  function initialize(
    address admin,
    string memory _name,
    string memory _symbol,
    uint256 _stableDepegPrice
  ) external initializer {
    __Context_init();
    __ERC165_init();
    __AccessControl_init();
    __ReentrancyGuard_init();

    __ERC20_init(_name, _symbol);
    __ERC20Permit_init(_name);

    _grantRole(DEFAULT_ADMIN_ROLE, admin);

    _updateStableDepegPrice(_stableDepegPrice);

    // approve
    IERC20(yieldToken).forceApprove(poolManager, type(uint256).max);
    IERC20(stableToken).forceApprove(poolManager, type(uint256).max);
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc IFxUSDBasePool
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

  /// @inheritdoc IFxUSDBasePool
  function previewRedeem(
    uint256 amountSharesToRedeem
  ) external view returns (uint256 amountYieldOut, uint256 amountStableOut) {
    uint256 cachedTotalYieldToken = totalYieldToken;
    uint256 cachedTotalStableToken = totalStableToken;
    uint256 cachedTotalSupply = totalSupply();
    amountYieldOut = (amountSharesToRedeem * cachedTotalYieldToken) / cachedTotalSupply;
    amountStableOut = (amountSharesToRedeem * cachedTotalStableToken) / cachedTotalSupply;
  }

  /// @inheritdoc IFxUSDBasePool
  function nav() external view returns (uint256) {
    uint256 _totalSupply = totalSupply();
    if (_totalSupply == 0) {
      return PRECISION;
    } else {
      uint256 stablePrice = getStableTokenPriceWithScale();
      uint256 yieldPrice = IPegKeeper(pegKeeper).getFxUSDPrice();
      return (totalYieldToken * yieldPrice + totalStableToken * stablePrice) / _totalSupply;
    }
  }

  /// @inheritdoc IFxUSDBasePool
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

  /// @inheritdoc IFxUSDBasePool
  function getStableTokenPriceWithScale() public view returns (uint256) {
    return getStableTokenPrice() * stableTokenScale;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IFxUSDBasePool
  function deposit(
    address receiver,
    address tokenIn,
    uint256 amountTokenToDeposit,
    uint256 minSharesOut
  ) external override nonReentrant onlyValidToken(tokenIn) returns (uint256 amountSharesOut) {
    if (amountTokenToDeposit == 0) revert ErrDepositZeroAmount();

    // we are very sure every token is normal token, so no fot check here.
    IERC20(tokenIn).safeTransferFrom(_msgSender(), address(this), amountTokenToDeposit);

    amountSharesOut = _deposit(tokenIn, amountTokenToDeposit);
    if (amountSharesOut < minSharesOut) revert ErrInsufficientSharesOut();

    _mint(receiver, amountSharesOut);

    emit Deposit(_msgSender(), receiver, tokenIn, amountTokenToDeposit, amountSharesOut);
  }

  /// @inheritdoc IFxUSDBasePool
  function redeem(
    address receiver,
    uint256 amountSharesToRedeem
  ) external nonReentrant returns (uint256 amountYieldOut, uint256 amountStableOut) {
    if (amountSharesToRedeem == 0) revert ErrRedeemZeroShares();

    uint256 cachedTotalYieldToken = totalYieldToken;
    uint256 cachedTotalStableToken = totalStableToken;
    uint256 cachedTotalSupply = totalSupply();

    amountYieldOut = (amountSharesToRedeem * cachedTotalYieldToken) / cachedTotalSupply;
    amountStableOut = (amountSharesToRedeem * cachedTotalStableToken) / cachedTotalSupply;

    _burn(_msgSender(), amountSharesToRedeem);

    if (amountYieldOut > 0) {
      IERC20(yieldToken).safeTransfer(receiver, amountYieldOut);
      unchecked {
        totalYieldToken = cachedTotalYieldToken - amountYieldOut;
      }
    }
    if (amountStableOut > 0) {
      IERC20(stableToken).safeTransfer(receiver, amountStableOut);
      unchecked {
        totalStableToken = cachedTotalStableToken - amountStableOut;
      }
    }

    emit Redeem(_msgSender(), receiver, amountSharesToRedeem, amountYieldOut, amountStableOut);
  }

  /// @inheritdoc IFxUSDBasePool
  function rebalance(
    address pool,
    int16 tickId,
    address tokenIn,
    uint256 maxAmount,
    uint256 minCollOut
  ) external onlyValidToken(tokenIn) nonReentrant returns (uint256 tokenUsed, uint256 colls) {
    RebalanceMemoryVar memory op = _beforeRebalanceOrLiquidate(tokenIn, maxAmount);
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

  /// @inheritdoc IFxUSDBasePool
  function rebalance(
    address pool,
    uint32 positionId,
    address tokenIn,
    uint256 maxAmount,
    uint256 minCollOut
  ) external onlyValidToken(tokenIn) nonReentrant returns (uint256 tokenUsed, uint256 colls) {
    RebalanceMemoryVar memory op = _beforeRebalanceOrLiquidate(tokenIn, maxAmount);
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

  /// @inheritdoc IFxUSDBasePool
  function liquidate(
    address pool,
    uint32 positionId,
    address tokenIn,
    uint256 maxAmount,
    uint256 minCollOut
  ) external onlyValidToken(tokenIn) nonReentrant returns (uint256 tokenUsed, uint256 colls) {
    RebalanceMemoryVar memory op = _beforeRebalanceOrLiquidate(tokenIn, maxAmount);
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

  /// @inheritdoc IFxUSDBasePool
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
        if (price < stableDepegPrice) revert ErrorStableTokenDepeg();
        if (amountIn > cachedTotalYieldToken) revert ErrorSwapExceedBalance();
        dstToken = stableToken;
        unchecked {
          // rounding up
          expectedOut = Math.mulDivUp(amountIn, PRECISION, scaledPrice);
          cachedTotalYieldToken -= amountIn;
          cachedTotalStableToken += expectedOut;
        }
      } else {
        if (amountIn > cachedTotalStableToken) revert ErrorSwapExceedBalance();
        dstToken = yieldToken;
        unchecked {
          // rounding up
          expectedOut = Math.mulDivUp(amountIn, scaledPrice, PRECISION);
          cachedTotalStableToken -= amountIn;
          cachedTotalYieldToken += expectedOut;
        }
      }
    }
    IERC20(srcToken).safeTransfer(pegKeeper, amountIn);
    uint256 actualOut = IERC20(dstToken).balanceOf(address(this));
    amountOut = IPegKeeper(pegKeeper).onSwap(srcToken, dstToken, amountIn, data);
    actualOut = IERC20(dstToken).balanceOf(address(this)) - actualOut;
    // check actual fxUSD swapped in case peg keeper is hacked.
    if (amountOut > actualOut) revert ErrorInsufficientOutput();
    // check swapped token has no loss
    if (amountOut < expectedOut) revert ErrorInsufficientArbitrage();

    totalYieldToken = cachedTotalYieldToken;
    totalStableToken = cachedTotalStableToken;
    bonusOut = amountOut - expectedOut;
    if (bonusOut > 0) {
      IERC20(dstToken).safeTransfer(receiver, bonusOut);
    }

    emit Arbitrage(_msgSender(), srcToken, amountIn, amountOut, bonusOut);
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Update depeg price for stable token.
  /// @param newPrice The new depeg price of stable token, multiplied by 1e18
  function updateStableDepegPrice(uint256 newPrice) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateStableDepegPrice(newPrice);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to update depeg price for stable token.
  /// @param newPrice The new depeg price of stable token, multiplied by 1e18
  function _updateStableDepegPrice(uint256 newPrice) internal {
    uint256 oldPrice = stableDepegPrice;
    stableDepegPrice = newPrice;

    emit UpdateStableDepegPrice(oldPrice, newPrice);
  }

  /// @dev mint shares based on the deposited base tokens
  /// @param tokenIn base token address used to mint shares
  /// @param amountDeposited amount of base tokens deposited
  /// @return amountSharesOut amount of shares minted
  function _deposit(address tokenIn, uint256 amountDeposited) internal virtual returns (uint256 amountSharesOut) {
    uint256 price = getStableTokenPriceWithScale();
    if (price < stableDepegPrice * stableTokenScale) revert ErrorStableTokenDepeg();

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

  /// @dev Internal hook function to prepare before rebalance or liquidate.
  /// @param tokenIn The address of input token.
  /// @param maxAmount The maximum amount of input tokens.
  function _beforeRebalanceOrLiquidate(
    address tokenIn,
    uint256 maxAmount
  ) internal view returns (RebalanceMemoryVar memory op) {
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
      if (maxAmountInUSD < amountYieldToken) amountYieldToken = maxAmountInUSD;
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

  /// @dev Internal hook function after rebalance or liquidate.
  /// @param tokenIn The address of input token.
  /// @param minCollOut The minimum expected collateral tokens.
  /// @param op The memory variable for rebalance or liquidate.
  /// @return tokenUsed The amount of input token used.
  function _afterRebalanceOrLiquidate(
    address tokenIn,
    uint256 minCollOut,
    RebalanceMemoryVar memory op
  ) internal returns (uint256 tokenUsed) {
    if (op.colls < minCollOut) revert ErrorInsufficientOutput();

    op.totalYieldToken -= op.yieldTokenUsed;
    op.totalStableToken -= op.stableTokenUsed;

    uint256 amountUSD = op.yieldTokenUsed + (op.stableTokenUsed * op.stablePrice) / PRECISION;
    if (tokenIn == yieldToken) {
      tokenUsed = amountUSD;
      op.totalYieldToken += tokenUsed;
    } else {
      // rounding up
      tokenUsed = Math.mulDivUp(amountUSD, PRECISION, op.stablePrice);
      op.totalStableToken += tokenUsed;
    }

    totalYieldToken = op.totalYieldToken;
    totalStableToken = op.totalStableToken;

    // transfer token from caller, the collateral is already transferred to caller.
    IERC20(tokenIn).safeTransferFrom(_msgSender(), address(this), tokenUsed);

    emit Rebalance(_msgSender(), tokenIn, tokenUsed, op.colls, op.yieldTokenUsed, op.stableTokenUsed);
  }
}
