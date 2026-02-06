// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import { IMultiPathConverter } from "../helpers/interfaces/IMultiPathConverter.sol";
import { ICurveStableSwapNG } from "../interfaces/Curve/ICurveStableSwapNG.sol";
import { IFxUSDRegeneracy } from "../interfaces/IFxUSDRegeneracy.sol";
import { IPegKeeper } from "../interfaces/IPegKeeper.sol";
import { IFxUSDBasePool } from "../interfaces/IFxUSDBasePool.sol";
import { IFxUSDPriceOracle } from "../interfaces/IFxUSDPriceOracle.sol";

contract PegKeeper is AccessControlUpgradeable, IPegKeeper {
  using SafeERC20 for IERC20;

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

  /// @notice The address of FxUSDBasePool.
  address public immutable fxBASE;

  /*********************
   * Storage Variables *
   *********************/

  /// @dev The context for buyback and stabilize callback.
  uint8 private context;

  /// @notice The address of MultiPathConverter.
  address public converter;

  /// @notice The address of FxUSDPriceOracle.
  address public oracle;

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

  constructor(address _fxBASE) {
    fxBASE = _fxBASE;
    fxUSD = IFxUSDBasePool(_fxBASE).yieldToken();
    stable = IFxUSDBasePool(_fxBASE).stableToken();
  }

  function initialize(address admin, address _converter, address _oracle) external initializer {
    __Context_init();
    __ERC165_init();
    __AccessControl_init();

    _grantRole(DEFAULT_ADMIN_ROLE, admin);

    _updateConverter(_converter);
    _updateFxUSDPriceOracle(_oracle);
    _updatePriceThreshold(995000000000000000); // 0.995

    context = CONTEXT_NO_CONTEXT;
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc IPegKeeper
  function isBorrowAllowed() external view returns (bool) {
    return _getFxUSDTwapPrice() >= priceThreshold;
  }

  /// @inheritdoc IPegKeeper
  function isFundingEnabled() external view returns (bool) {
    return _getFxUSDTwapPrice() < priceThreshold;
  }

  /// @inheritdoc IPegKeeper
  function isRedeemAllowed() external view returns (bool) {
    return _getFxUSDTwapPrice() < priceThreshold;
  }

  /// @inheritdoc IPegKeeper
  function getFxUSDPrice() external view returns (uint256) {
    return _getFxUSDTwapPrice();
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IPegKeeper
  function buyback(
    uint256 amountIn,
    bytes calldata data
  ) external onlyRole(BUYBACK_ROLE) setContext(CONTEXT_BUYBACK) returns (uint256 amountOut, uint256 bonus) {
    (amountOut, bonus) = IFxUSDRegeneracy(fxUSD).buyback(amountIn, _msgSender(), data);
  }

  /// @inheritdoc IPegKeeper
  function stabilize(
    address srcToken,
    uint256 amountIn,
    bytes calldata data
  ) external onlyRole(STABILIZE_ROLE) setContext(CONTEXT_STABILIZE) returns (uint256 amountOut, uint256 bonus) {
    (amountOut, bonus) = IFxUSDBasePool(fxBASE).arbitrage(srcToken, amountIn, _msgSender(), data);
  }

  /// @inheritdoc IPegKeeper
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
    IERC20(targetToken).safeTransfer(_msgSender(), amountOut);
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Update the address of converter.
  /// @param newConverter The address of converter.
  function updateConverter(address newConverter) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateConverter(newConverter);
  }

  /// @notice Update the address of FxUSDPriceOracle.
  /// @param newOracle The address of FxUSDPriceOracle.
  function updateFxUSDPriceOracle(address newOracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateFxUSDPriceOracle(newOracle);
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

  /// @dev Internal function to update the address of FxUSDPriceOracle.
  /// @param newOracle The address of FxUSDPriceOracle.
  function _updateFxUSDPriceOracle(address newOracle) internal {
    if (newOracle == address(0)) revert ErrorZeroAddress();

    address oldOracle = oracle;
    oracle = newOracle;

    emit UpdateFxUSDPriceOracle(oldOracle, newOracle);
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
    IERC20(srcToken).forceApprove(converter, amountIn);

    (uint256 minOut, uint256 encoding, uint256[] memory routes) = abi.decode(data, (uint256, uint256, uint256[]));
    amountOut = IMultiPathConverter(converter).convert(srcToken, amountIn, encoding, routes);
    if (amountOut < minOut) revert ErrorInsufficientOutput();
  }

  function _getFxUSDTwapPrice() internal view returns (uint256 price) {
    (, price) = IFxUSDPriceOracle(oracle).getPrice();
  }
}
