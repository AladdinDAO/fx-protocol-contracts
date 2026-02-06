// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import { Math } from "@openzeppelin/contracts-v4/utils/math/Math.sol";

import { AggregatorV3Interface } from "../interfaces/Chainlink/AggregatorV3Interface.sol";
import { IFxUSDPriceOracle } from "../interfaces/IFxUSDPriceOracle.sol";

import { OracleLibrary } from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import { IUniswapV3Pool } from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import { TickMath } from "@uniswap/v3-core/contracts/libraries/TickMath.sol";

contract FxUSDPriceOracle is AccessControlUpgradeable, IFxUSDPriceOracle {
  /**********
   * Errors *
   **********/

  /// @dev Thrown when the address is zero address.
  error ErrorZeroAddress();

  /// @dev Thrown when the provided pool address is invalid or does not conform to the expected pool interface.
  error ErrorInvalidPool();

  /// @dev Thrown when fxUSD is not one of the tokens in the specified pool.
  error ErrorFxUSDNotInPool();

  /// @dev Thrown when the pool does not have sufficient liquidity to perform the requested operation.
  error ErrorInsufficientLiquidity();

  /// @dev Thrown when there are not enough oracle observations to calculate TWAP or other time-based metrics.
  error ErrorNotEnoughObservations();

  /*************
   * Constants *
   *************/

  /// @dev The precision used to compute nav.
  uint256 private constant PRECISION = 1e18;
  uint256 private constant HALF_PRECISION = 1e9;
  uint256 private constant E96 = 2 ** 96; // 2^96

  /***********************
   * Immutable Variables *
   ***********************/

  /// @notice The fxUSD token.
  address public immutable fxUSD;

  /// @notice The Chainlink USDC/USD price feed.
  /// @dev The encoding is below.
  /// ```text
  /// |  32 bits  | 64 bits |  160 bits  |
  /// | heartbeat |  scale  | price_feed |
  /// |low                          high |
  /// ```
  bytes32 public immutable Chainlink_USDC_USD_Spot;

  /*********************
   * Storage Variables *
   *********************/

  /// @notice The sushi pool for stable and fxUSD
  address public sushiPool;

  /// @notice The seconds ago to consult the price.
  uint256 public secondsAgo;

  /// @notice The minimum liquidity to consult the price.
  uint128 public minLiquidity;

  /// @notice The fxUSD depeg price threshold.
  uint256 public maxDePegPriceDeviation;

  /// @notice The max price deviation for up peg.
  uint256 public maxUpPegPriceDeviation;

  /***************
   * Constructor *
   ***************/

  /// @notice Constructor.
  /// @param _fxUSD The address of the fxUSD token.
  constructor(address _fxUSD, bytes32 _Chainlink_USDC_USD_Spot) {
    fxUSD = _fxUSD;
    Chainlink_USDC_USD_Spot = _Chainlink_USDC_USD_Spot;
  }

  /// @notice Initialize the contract storage.
  /// @param admin The address of the admin.
  /// @param _sushiPool The address of the sushi pool.
  function initialize(
    address admin,
    address _sushiPool,
    uint256 _secondsAgo,
    uint128 _minLiquidity
  ) external initializer {
    __Context_init();
    __AccessControl_init();
    __ERC165_init();

    _grantRole(DEFAULT_ADMIN_ROLE, admin);

    _updateSushiPool(_sushiPool, _secondsAgo, _minLiquidity);
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc IFxUSDPriceOracle
  function getUSDCPrice() external view returns (uint256) {
    return _readUSDCPriceByChainlink();
  }

  /// @inheritdoc IFxUSDPriceOracle
  function getPrice() external view returns (bool isPegged, uint256 price) {
    price = _getFxUSDTwapPrice();
    isPegged = price >= PRECISION - maxDePegPriceDeviation && price <= PRECISION + maxUpPegPriceDeviation;
  }

  /// @inheritdoc IFxUSDPriceOracle
  function isPriceAboveMaxDeviation() external view returns (bool) {
    return _getFxUSDTwapPrice() > PRECISION + maxUpPegPriceDeviation;
  }

  /// @inheritdoc IFxUSDPriceOracle
  function isPriceBelowMaxDeviation() external view returns (bool) {
    return _getFxUSDTwapPrice() < PRECISION - maxDePegPriceDeviation;
  }

  /************************
   * Restricted Functions *
   ************************/

  /// @notice Update the address sushi pool.
  /// @param _newPool The address of sushi pool.
  /// @param _secondsAgo The seconds ago to consult the price.
  /// @param _minLiquidity The minimum liquidity to consult the price.
  function updateSushiPool(
    address _newPool,
    uint256 _secondsAgo,
    uint128 _minLiquidity
  ) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _updateSushiPool(_newPool, _secondsAgo, _minLiquidity);
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

  /// @dev Internal function to get sushi twap price for fxUSD.
  /// @return price The value of twap price, multiplied by 1e18.
  function _getFxUSDTwapPrice() internal view returns (uint256 price) {
    address pool = sushiPool;

    if (pool == address(0)) revert ErrorInvalidPool();

    // ----------------------------
    // 1. Validate pool tokens
    // ----------------------------
    address token0 = IUniswapV3Pool(pool).token0();
    address token1 = IUniswapV3Pool(pool).token1();

    if (token0 != fxUSD && token1 != fxUSD) {
      revert ErrorFxUSDNotInPool();
    }

    // ----------------------------
    // 2. Read TWAP tick + liquidity
    // ----------------------------
    (int24 meanTick, uint128 liquidity) = OracleLibrary.consult(pool, uint32(secondsAgo));

    if (liquidity < minLiquidity) {
      revert ErrorInsufficientLiquidity();
    }

    // ----------------------------
    // 3. Convert tick → price
    // ----------------------------
    uint256 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(meanTick);
    if (token1 == fxUSD) {
      sqrtPriceX96 = (E96 * E96) / sqrtPriceX96;
    }
    // now quote=USDC, base=fxUSD
    // fxUSD 18 decimals, USDC 6 decimals
    uint256 scale = Math.sqrt(10 ** 12);
    uint256 usdcPerFxUSD = (sqrtPriceX96 * HALF_PRECISION * scale) / E96;
    usdcPerFxUSD = usdcPerFxUSD * usdcPerFxUSD;

    // ----------------------------
    // 4. Convert USDC → USD
    // ----------------------------
    uint256 usdcUsd = _readUSDCPriceByChainlink();

    price = (usdcUsd * usdcPerFxUSD) / PRECISION;
  }

  /// @dev Internal function to update the address of sushi pool.
  /// @param _sushiPool The address of sushi pool.
  /// @param _secondsAgo The seconds ago to consult the price.
  /// @param _minLiquidity The minimum liquidity to consult the price.
  function _updateSushiPool(address _sushiPool, uint256 _secondsAgo, uint128 _minLiquidity) internal {
    if (_sushiPool == address(0)) revert ErrorZeroAddress();

    address oldPool = sushiPool;
    sushiPool = _sushiPool;
    secondsAgo = _secondsAgo;
    minLiquidity = _minLiquidity;

    emit UpdateSushiPool(oldPool, _sushiPool, _secondsAgo, _minLiquidity);
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

  /// @dev Internal function to read the USDC/USD price from Chainlink.
  function _readUSDCPriceByChainlink() internal view returns (uint256) {
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
}
