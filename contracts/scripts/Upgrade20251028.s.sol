// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { ProxyAdmin } from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { ProtocolTreasury } from "../helpers/ProtocolTreasury.sol";

contract Upgrade20251028 is Script {
  address public constant ProtocolTreasuryImplementation = 0xc4160f6D4149e0921e9ACed406acf5F3aD7F2882;
  address public constant FxProxyAdmin = 0x9B54B7703551D9d0ced177A78367560a8B2eDDA4;
  address public constant FxMultisig = 0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF;

  function run() public {
    uint256 privateKey = vm.envUint("PRIVATE_KEY_MAINNET");
    address deployer = vm.addr(privateKey);
    console.log("deployer", deployer);

    vm.startBroadcast(deployer);
    TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
      ProtocolTreasuryImplementation,
      FxProxyAdmin,
      abi.encodeCall(ProtocolTreasury.initialize, (deployer))
    );
    ProtocolTreasury(address(proxy)).grantRole(0x00, FxMultisig);
    vm.stopBroadcast();

    console.log("ProtocolTreasuryFxMintProxy", address(proxy));
  }
}
