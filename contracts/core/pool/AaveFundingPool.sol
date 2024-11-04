// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { IAaveV3Pool } from "../../interfaces/Aave/IAaveV3Pool.sol";
import { IPegKeeper } from "../../interfaces/IPegKeeper.sol";

import { BasePool } from "./BasePool.sol";

contract AaveFundingPool is BasePool {
  address private immutable lendingPool;

  address private immutable baseAsset;

  /// @param ratio multiplied by 1e18
  struct AaveInterestRate {
    uint128 rate;
    uint64 timestamp;
  }

  AaveInterestRate public interestRate;

  // 30 bits, max 1e9
  uint256 public openRatio;
  // 60 bits, max 1e18
  uint256 public openRatioStep;
  // 30 bits, max 1e9
  uint256 public closeRatio;

  uint256 public fundingRatio;

  constructor(address _poolManager, address _lendingPool, address _baseAsset) BasePool(_poolManager) {
    lendingPool = _lendingPool;
    baseAsset = _baseAsset;
  }

  function initialize(string memory name_, string memory symbol_) external initializer {
    __Context_init();
    __ERC165_init();
    __ERC721_init(name_, symbol_);
    __AccessControl_init();

    __TickLogic_init();
    __PositionLogic_init();
    __BasePool_init();

    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  function _updateCollAndDebtIndex() internal virtual override returns (uint256 newCollIndex, uint256 newDebtIndex) {
    newCollIndex = collIndex;
    newDebtIndex = debtIndex;

    AaveInterestRate memory cachedInterestRate = interestRate;
    if (block.timestamp > cachedInterestRate.rate) {
      if (IPegKeeper(pegKeeper).isFundingEnabled()) {
        uint256 totalRawColls = _convertToRawColl(totalColls, newCollIndex);
        uint256 funding = (totalRawColls * interestRate.rate * (block.timestamp - interestRate.rate)) / (365 * 86400);
        newCollIndex = (newCollIndex * totalRawColls) / (totalRawColls - funding);
        collIndex = newCollIndex;
      }

      // update interest snapshot
      IAaveV3Pool.ReserveDataLegacy memory reserveData = IAaveV3Pool(lendingPool).getReserveData(baseAsset);
      // the interest rate from aave is scaled by 1e27, we want 1e18 scale.
      cachedInterestRate.rate = uint128(reserveData.currentVariableBorrowRate / 1e9);
      cachedInterestRate.timestamp = uint64(block.timestamp);
      interestRate = cachedInterestRate;
    }
  }

  function _deductProtocolFees(int256 rawColl) internal view virtual override returns (uint256) {
    if (rawColl > 0) {
      // open position or add collateral
      uint256 aaveRatio = interestRate.rate <= openRatioStep ? 1 : (interestRate.rate - 1) / openRatioStep;
      return (uint256(rawColl) * openRatio * aaveRatio) / FEE_PRECISION;
    } else {
      // close position or remove collateral
      return (uint256(-rawColl) * closeRatio) / FEE_PRECISION;
    }
  }
}
