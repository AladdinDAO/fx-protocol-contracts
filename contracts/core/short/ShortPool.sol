// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IPriceOracle } from "../../price-oracle/interfaces/IPriceOracle.sol";
import { IPoolConfiguration } from "../../interfaces/IPoolConfiguration.sol";
import { IShortPool } from "../../interfaces/IShortPool.sol";
import { ILongPool } from "../../interfaces/ILongPool.sol";

import { Math } from "../../libraries/Math.sol";
import { BasePool } from "../pool/BasePool.sol";

contract ShortPool is BasePool, IShortPool {
  /**********
   * Errors *
   **********/

  error ErrorPoolKilled();

  /*********************
   * Storage Variables *
   *********************/

  /// @inheritdoc IShortPool
  address public debtToken;

  /// @inheritdoc IShortPool
  address public creditNote;

  /// @notice The timestamp of the last funding.
  uint256 public lastFundingTimestamp;

  /// @notice Whether the pool is killed.
  bool public isKilled;

  /***************
   * Constructor *
   ***************/

  constructor(address _poolManager, address _configuration) BasePool(_poolManager, _configuration) {}

  function initialize(
    address admin,
    string memory name_,
    string memory symbol_,
    address _priceOracle,
    address _debtToken,
    address _creditNote
  ) external initializer {
    __Context_init();
    __ERC165_init();
    __ERC721_init(name_, symbol_);
    __AccessControl_init();

    __PoolStorage_init(fxUSD, _priceOracle);
    __TickLogic_init();
    __PositionLogic_init();
    __BasePool_init();

    _grantRole(DEFAULT_ADMIN_ROLE, admin);

    debtToken = _debtToken;
    creditNote = _creditNote;
  }

  /*************************
   * Public View Functions *
   *************************/

  /// @inheritdoc IShortPool
  function isUnderCollateral() external onlyPoolManager returns (bool underCollateral, uint256 shortfall) {
    (uint256 debtIndex, uint256 collIndex) = _updateCollAndDebtIndex();

    (uint256 totalDebtShares, uint256 totalColls) = _getDebtAndCollateralShares();
    uint256 price = IPriceOracle(priceOracle).getLiquidatePrice();

    uint256 totalRawColls = _convertToRawColl(totalColls, collIndex, Math.Rounding.Down);
    uint256 totalRawDebts = _convertToRawDebt(totalDebtShares, debtIndex, Math.Rounding.Down);
    underCollateral = totalRawDebts * PRECISION >= totalRawColls * price;
    shortfall = underCollateral ? totalRawDebts - (totalRawColls * price) / PRECISION : 0;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IShortPool
  function kill() external onlyPoolManager {
    isKilled = true;
  }

  /// @inheritdoc IShortPool
  function redeemByCreditNote(uint256 creditNoteAmount) external onlyPoolManager returns (uint256 rawColls) {
    (, rawColls) = _redeem(creditNoteAmount, true);
  }

  /**********************
   * Internal Functions *
   **********************/

  /// @inheritdoc BasePool
  function _updateCollAndDebtIndex() internal virtual override returns (uint256 newCollIndex, uint256 newDebtIndex) {
    if (isKilled) revert ErrorPoolKilled();

    (newDebtIndex, newCollIndex) = _getDebtAndCollateralIndex();

    uint256 duration = block.timestamp - lastFundingTimestamp;
    if (duration > 0) {
      uint256 fundingRatio = IPoolConfiguration(configuration).getShortPoolFundingRatio(address(this));
      if (fundingRatio > 0) {
        (, uint256 totalColls) = _getDebtAndCollateralShares();
        uint256 totalRawColls = _convertToRawColl(totalColls, newCollIndex, Math.Rounding.Down);
        uint256 funding = (totalRawColls * fundingRatio * duration) / (PRECISION * 365 days);

        // update collateral index with funding costs
        newCollIndex = (newCollIndex * totalRawColls) / (totalRawColls - funding);
        _updateCollateralIndex(newCollIndex);
      }

      // checkpoint on pool configuration
      IPoolConfiguration(configuration).checkpoint(address(this));

      lastFundingTimestamp = block.timestamp;
    }
  }

  /// @inheritdoc BasePool
  function _deductProtocolFees(int256) internal view virtual override returns (uint256) {
    return 0;
  }
}
