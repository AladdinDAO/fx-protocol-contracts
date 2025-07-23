// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import { ICurveStableSwapNG } from "../interfaces/Curve/ICurveStableSwapNG.sol";
import { IFxUSDPriceOracle } from "../interfaces/IFxUSDPriceOracle.sol";

contract FxUSDPriceOracle is AccessControlUpgradeable, IFxUSDPriceOracle {
  /**********
   * Errors *
   **********/

  /// @dev Thrown when the address is zero address.
  error ErrorZeroAddress();

  /*************
   * Constants *
   *************/

  /// @dev The precision used to compute nav.
  uint256 private constant PRECISION = 1e18;

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The fxUSD token.
  address public immutable fxUSD;

  /*********************
   * Storage Variables *
   *********************/

  /// @notice The curve pool for stable and fxUSD
  address public curvePool;

  /// @notice The fxUSD depeg price threshold.
  uint256 public maxDePegPriceDeviation;

  /// @notice The max price deviation for up peg.
  uint256 public maxUpPegPriceDeviation;

  /***************
   * Constructor *
   ***************/

  /// @notice Constructor.
  /// @param _fxUSD The address of the fxUSD token.
  constructor(address _fxUSD) {
    fxUSD = _fxUSD;
  }

  /// @notice Initialize the contract storage.
  /// @param admin The address of the admin.
  /// @param _curvePool The address of the curve pool.
  function initialize(address admin, address _curvePool) external initializer {
    __Context_init();
    __AccessControl_init();
    __ERC165_init();

    _grantRole(DEFAULT_ADMIN_ROLE, admin);

    _updateCurvePool(_curvePool);
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc IFxUSDPriceOracle
  function getPrice() external view returns (bool isPegged, uint256 price) {
    price = _getFxUSDEmaPrice();
    isPegged = price >= PRECISION - maxDePegPriceDeviation && price <= PRECISION + maxUpPegPriceDeviation;
  }

  /// @inheritdoc IFxUSDPriceOracle
  function isPriceAboveMaxDeviation() external view returns (bool) {
    return _getFxUSDEmaPrice() > PRECISION + maxUpPegPriceDeviation;
  }

  /// @inheritdoc IFxUSDPriceOracle
  function isPriceBelowMaxDeviation() external view returns (bool) {
    return _getFxUSDEmaPrice() < PRECISION - maxDePegPriceDeviation;
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Update the address of curve pool.
  /// @param newPool The address of curve pool.
  function updateCurvePool(address newPool) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateCurvePool(newPool);
  }

  /// @notice Update the value of depeg/uppeg price threshold.
  /// @param newDePegDeviation The value of new depeg price threshold.
  /// @param newUpPegDeviation The value of new up peg price threshold.
  function updateMaxPriceDeviation(
    uint256 newDePegDeviation,
    uint256 newUpPegDeviation
  ) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateMaxPriceDeviation(newDePegDeviation, newUpPegDeviation);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @dev Internal function to get curve ema price for fxUSD.
  /// @return price The value of ema price, multiplied by 1e18.
  function _getFxUSDEmaPrice() internal view returns (uint256 price) {
    address cachedCurvePool = curvePool; // gas saving
    address firstCoin = ICurveStableSwapNG(cachedCurvePool).coins(0);
    price = ICurveStableSwapNG(cachedCurvePool).price_oracle(0);
    if (firstCoin == fxUSD) {
      price = (PRECISION * PRECISION) / price;
    }
  }

  /// @dev Internal function to update the address of curve pool.
  /// @param newPool The address of curve pool.
  function _updateCurvePool(address newPool) internal {
    if (newPool == address(0)) revert ErrorZeroAddress();

    address oldPool = curvePool;
    curvePool = newPool;

    emit UpdateCurvePool(oldPool, newPool);
  }

  /// @dev Internal function to update the value of max price deviation.
  /// @param newDePegDeviation The value of new depeg price deviation.
  /// @param newUpPegDeviation The value of new up peg price deviation.
  function _updateMaxPriceDeviation(uint256 newDePegDeviation, uint256 newUpPegDeviation) internal {
    uint256 oldDePegDeviation = maxDePegPriceDeviation;
    uint256 oldUpPegDeviation = maxUpPegPriceDeviation;
    maxDePegPriceDeviation = newDePegDeviation;
    maxUpPegPriceDeviation = newUpPegDeviation;

    emit UpdateMaxPriceDeviation(oldDePegDeviation, oldUpPegDeviation, newDePegDeviation, newUpPegDeviation);
  }
}
