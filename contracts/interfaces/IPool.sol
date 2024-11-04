// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IPool {
  struct LiquidateResult {
    uint256 rawColls;
    uint256 rawDebts;
    uint256 bonusRawColls;
    uint256 bonusFromReserve;
  }

  struct RebalanceResult {
    uint256 rawColls;
    uint256 rawDebts;
    uint256 bonusRawColls;
  }

  function fxUSD() external view returns (address);

  function collateralToken() external view returns (address);

  function getTotalRawColls() external view returns (uint256);

  function operate(
    uint256 positionId,
    int256 newRawColl,
    int256 newRawDebt,
    address owner
  ) external returns (uint256 actualPositionId, int256 actualRawColl, int256 actualRawDebt, uint256 protocolFees);

  function redeem(uint256 rawDebts) external returns (uint256 rawColls);

  function rebalance(int16 tick, uint256 maxRawDebts) external returns (RebalanceResult memory result);

  function rebalance(uint32 positionId, uint256 maxRawDebts) external returns (RebalanceResult memory result);

  function liquidate(
    uint256 positionId,
    uint256 maxRawDebts,
    uint256 reservedRawDebts
  ) external returns (LiquidateResult memory result);
}
