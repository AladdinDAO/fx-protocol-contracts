// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface ITokenMinter {
  function token() external view returns (address);

  /// @notice Returns the current epoch number.
  function getMiningEpoch() external view returns (uint256);

  /// @notice Returns the start timestamp of the current epoch.
  function getStartEpochTime() external view returns (uint256);

  /// @notice Returns the start timestamp of the next epoch.
  function getFutureEpochTime() external view returns (uint256);

  /// @notice Returns the available supply at the beginning of the current epoch.
  function getStartEpochSupply() external view returns (uint256);

  /// @notice Returns the current inflation rate of BAL per second
  function getInflationRate() external view returns (uint256);

  /// @notice Maximum allowable number of tokens in existence (claimed or unclaimed)
  function getAvailableSupply() external view returns (uint256);

  /// @notice Get timestamp of the current mining epoch start while simultaneously updating mining parameters
  /// @return Timestamp of the current epoch
  function startEpochTimeWrite() external returns (uint256);

  /// @notice Get timestamp of the next mining epoch start while simultaneously updating mining parameters
  /// @return Timestamp of the next epoch
  function futureEpochTimeWrite() external returns (uint256);

  /// @notice Update mining rate and supply at the start of the epoch
  /// @dev Callable by any address, but only once per epoch
  /// Total supply becomes slightly larger if this function is called late
  function updateMiningParameters() external;

  /// @notice How much supply is mintable from start timestamp till end timestamp
  /// @param start Start of the time interval (timestamp)
  /// @param end End of the time interval (timestamp)
  /// @return Tokens mintable from `start` till `end`
  function mintableInTimeframe(uint256 start, uint256 end) external view returns (uint256);

  function mint(address to, uint256 amount) external;
}