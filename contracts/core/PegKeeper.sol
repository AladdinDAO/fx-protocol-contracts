// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable-v4/access/AccessControlUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/IERC20Upgradeable.sol";

import { IMultiPathConverter } from "../helpers/interfaces/IMultiPathConverter.sol";
import { ICurveStableSwapNG } from "../interfaces/Curve/ICurveStableSwapNG.sol";
import { IFxUSDRegeneracy } from "../interfaces/IFxUSDRegeneracy.sol";
import { IPegKeeper } from "../interfaces/IPegKeeper.sol";
import { IStakedFxUSD } from "../interfaces/IStakedFxUSD.sol";

contract PegKeeper is AccessControlUpgradeable, IPegKeeper {
  using SafeERC20Upgradeable for IERC20Upgradeable;

  /**********
   * Errors *
   **********/

  error ErrorNotInCallbackContext();

  error ErrorZeroAddress();

  error ErrorInsufficientOutput();

  /*************
   * Constants *
   *************/

  /// @dev The precision used to compute nav.
  uint256 private constant PRECISION = 1e18;

  /// @notice The role for buyback.
  bytes32 public constant BUYBACK_ROLE = keccak256("BUYBACK_ROLE");

  /// @notice The role for stabilize.
  bytes32 public constant STABILIZE_ROLE = keccak256("STABILIZE_ROLE");

  /// @dev contexts for buyback and stabilize callback
  uint8 private constant CONTEXT_NO_CONTEXT = 1;
  uint8 private constant CONTEXT_BUYBACK = 2;
  uint8 private constant CONTEXT_STABILIZE = 3;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The address of fxUSD.
  address public immutable fxUSD;

  /// @notice The address of stable token.
  address public immutable stable;

  /// @notice The address of sfxUSD.
  address public immutable sfxUSD;

  /*********************
   * Storage Variables *
   *********************/

  /// @dev The context for buyback and stabilize callback.
  uint8 private context;

  /// @notice The address of MultiPathConverter.
  address public converter;

  /// @notice The curve pool for stable and fxUSD
  address public curvePool;

  /// @notice The fxUSD depeg price threshold.
  uint256 public priceThreshold;

  /*************
   * Modifiers *
   *************/

  modifier setContext(uint8 c) {
    context = c;
    _;
    context = CONTEXT_NO_CONTEXT;
  }

  /***************
   * Constructor *
   ***************/

  constructor(address _sfxUSD) {
    sfxUSD = _sfxUSD;
    fxUSD = IStakedFxUSD(_sfxUSD).yieldToken();
    stable = IStakedFxUSD(_sfxUSD).stableToken();
  }

  function initialize(address _converter) external initializer {
    __Context_init();
    __ERC165_init();
    __AccessControl_init();

    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());

    _updateConverter(_converter);
    _updatePriceThreshold(995000000000000000); // 0.995

    context = CONTEXT_NO_CONTEXT;
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc IPegKeeper
  function isBorrowAllowed() external view returns (bool) {
    return _getFxUSDEmaPrice() >= priceThreshold;
  }

  /// @inheritdoc IPegKeeper
  function isFundingEnabled() external view returns (bool) {
    return _getFxUSDEmaPrice() < priceThreshold;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IPegKeeper
  function buyback(
    uint256 amountIn,
    bytes calldata data
  ) external onlyRole(STABILIZE_ROLE) setContext(CONTEXT_BUYBACK) returns (uint256 amountOut, uint256 bonus) {
    (amountOut, bonus) = IFxUSDRegeneracy(fxUSD).buyback(amountIn, _msgSender(), data);
  }

  /// @inheritdoc IPegKeeper
  function stabilize(
    address srcToken,
    uint256 amountIn,
    bytes calldata data
  ) external onlyRole(STABILIZE_ROLE) setContext(CONTEXT_STABILIZE) returns (uint256 amountOut, uint256 bonus) {
    (amountOut, bonus) = IStakedFxUSD(sfxUSD).arbitrage(srcToken, amountIn, _msgSender(), data);
  }

  /// @dev This function will be called in `buyback`, `stabilize`.
  function onSwap(
    address srcToken,
    address targetToken,
    uint256 amountIn,
    bytes calldata data
  ) external returns (uint256 amountOut) {
    // check callback validity
    if (context == CONTEXT_NO_CONTEXT) revert ErrorNotInCallbackContext();

    amountOut = _doSwap(srcToken, amountIn, data);
    IERC20Upgradeable(targetToken).safeTransfer(_msgSender(), amountOut);
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Update the address of converter.
  /// @param newConverter The address of converter.
  function updateConverter(address newConverter) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateConverter(newConverter);
  }

  /// @notice Update the value of depeg price threshold.
  /// @param newThreshold The value of new price threshold.
  function updatePriceThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updatePriceThreshold(newThreshold);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to update the address of converter.
  /// @param newConverter The address of converter.
  function _updateConverter(address newConverter) internal {
    if (newConverter == address(0)) revert ErrorZeroAddress();

    address oldConverter = converter;
    converter = newConverter;

    emit UpdateConverter(oldConverter, newConverter);
  }

  /// @dev Internal function to update the value of depeg price threshold.
  /// @param newThreshold The value of new price threshold.
  function _updatePriceThreshold(uint256 newThreshold) internal {
    uint256 oldThreshold = priceThreshold;
    priceThreshold = newThreshold;

    emit UpdatePriceThreshold(oldThreshold, newThreshold);
  }

  /// @dev Internal function to do swap.
  /// @param srcToken The address of source token.
  /// @param amountIn The amount of token to use.
  /// @param data The callback data.
  /// @return amountOut The amount of token swapped.
  function _doSwap(address srcToken, uint256 amountIn, bytes calldata data) internal returns (uint256 amountOut) {
    IERC20Upgradeable(srcToken).safeApprove(converter, 0);
    IERC20Upgradeable(srcToken).safeApprove(converter, amountIn);

    (uint256 minOut, uint256 encoding, uint256[] memory routes) = abi.decode(data, (uint256, uint256, uint256[]));
    amountOut = IMultiPathConverter(converter).convert(srcToken, amountIn, encoding, routes);
    if (amountOut < minOut) revert ErrorInsufficientOutput();
  }

  /// @dev Internal function to get curve ema price for fxUSD.
  /// @return price The value of ema price, multiplied by 1e18.
  function _getFxUSDEmaPrice() internal view returns (uint256 price) {
    address firstCoin = ICurveStableSwapNG(curvePool).coins(0);
    price = ICurveStableSwapNG(curvePool).price_oracle(0);
    if (firstCoin == fxUSD) {
      price = (PRECISION * PRECISION) / price;
    }
  }
}
