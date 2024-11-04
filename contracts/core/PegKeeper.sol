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

  /*************
   * Constants *
   *************/

  /// @dev The precision used to compute nav.
  uint256 private constant PRECISION = 1e18;

  bytes32 public constant BUYBACK_ROLE = keccak256("BUYBACK_ROLE");

  bytes32 public constant STABILIZE_ROLE = keccak256("STABILIZE_ROLE");

  uint8 private constant CONTEXT_NO_CONTEXT = 1;

  uint8 private constant CONTEXT_BUYBACK = 2;

  uint8 private constant CONTEXT_STABILIZE = 3;

  /***********************
   * Immutable Variables *
   ***********************/

  address public immutable fxUSD;

  address public immutable stable;

  address public immutable sfxUSD;

  /*********************
   * Storage Variables *
   *********************/

  uint8 private context;

  address public converter;

  /// @notice The curve pool for stable and fxUSD
  address public curvePool;

  uint256 public priceThreshold;

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

  function isBorrowAllowed() external view returns (bool) {
    return _getFxUSDEmaPrice() >= priceThreshold;
  }

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
    if (context == CONTEXT_NO_CONTEXT) revert();

    amountOut = _doSwap(srcToken, amountIn, data);
    IERC20Upgradeable(targetToken).safeTransfer(_msgSender(), amountOut);
  }

  /************************
   * Restricted Functions *
   ************************/

  function updateConverter(address newConverter) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateConverter(newConverter);
  }

  function updatePriceThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updatePriceThreshold(newThreshold);
  }

  /**********************
   * Internal Functions *
   **********************/

  function _updateConverter(address newConverter) internal {
    if (newConverter == address(0)) revert();

    converter = newConverter;
  }

  function _updatePriceThreshold(uint256 newThreshold) internal {
    priceThreshold = newThreshold;
  }

  function _doSwap(address srcToken, uint256 amountIn, bytes calldata data) internal returns (uint256 amountOut) {
    IERC20Upgradeable(srcToken).safeApprove(converter, 0);
    IERC20Upgradeable(srcToken).safeApprove(converter, amountIn);

    (uint256 minOut, uint256 encoding, uint256[] memory routes) = abi.decode(data, (uint256, uint256, uint256[]));
    amountOut = IMultiPathConverter(converter).convert(srcToken, amountIn, encoding, routes);
    if (amountOut < minOut) revert();
  }

  function _getFxUSDEmaPrice() internal view returns (uint256 price) {
    address firstCoin = ICurveStableSwapNG(curvePool).coins(0);
    price = ICurveStableSwapNG(curvePool).price_oracle(0);
    if (firstCoin == fxUSD) {
      price = (PRECISION * PRECISION) / price;
    }
  }
}
