// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ProxyAdmin as OZProxyAdmin } from "@openzeppelin/contracts-v4/proxy/transparent/ProxyAdmin.sol";

import { TransparentUpgradeableProxy as OZTransparentUpgradeableProxy } from "@openzeppelin/contracts-v4/proxy/transparent/TransparentUpgradeableProxy.sol";

contract ProxyAdmin is OZProxyAdmin {}

contract TransparentUpgradeableProxy is OZTransparentUpgradeableProxy {
  constructor(
    address _logic,
    address admin_,
    bytes memory _data
  ) OZTransparentUpgradeableProxy(_logic, admin_, _data) {}
}
