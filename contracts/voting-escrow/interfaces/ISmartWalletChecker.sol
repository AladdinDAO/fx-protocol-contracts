// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface ISmartWalletChecker {
  function check(address) external view returns (bool);
}