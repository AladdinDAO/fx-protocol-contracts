// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

import { ITransparentUpgradeableProxy } from "@openzeppelin/contracts-v4/proxy/transparent/TransparentUpgradeableProxy.sol";
import { ProxyAdmin } from "@openzeppelin/contracts-v4/proxy/transparent/ProxyAdmin.sol";

import { DiamondCutFacet } from "../../contracts/common/EIP2535/facets/DiamondCutFacet.sol";
import { DiamondLoupeFacet } from "../../contracts/common/EIP2535/facets/DiamondLoupeFacet.sol";
import { OwnershipFacet } from "../../contracts/common/EIP2535/facets/OwnershipFacet.sol";
import { IDiamond } from "../../contracts/common/EIP2535/interfaces/IDiamond.sol";
import { ITokenConverter } from "../../contracts/helpers/interfaces/ITokenConverter.sol";

import { FxUSDRegeneracy } from "../../contracts/core/FxUSDRegeneracy.sol";
import { FxUSDBasePool } from "../../contracts/core/FxUSDBasePool.sol";
import { SavingFxUSD } from "../../contracts/core/SavingFxUSD.sol";
import { PoolConfiguration } from "../../contracts/core/PoolConfiguration.sol";
import { AaveFundingPool } from "../../contracts/core/pool/AaveFundingPool.sol";
import { PoolManager } from "../../contracts/core/PoolManager.sol";
import { ShortPool } from "../../contracts/core/short/ShortPool.sol";
import { ShortPoolManager } from "../../contracts/core/short/ShortPoolManager.sol";

abstract contract ForkBase is Test {
  /*********************
   * Mainnet contracts *
   *********************/

  /// @dev The address of fx multisig.
  address internal constant FxMultisig = 0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF;

  /// @dev The address of diamond router.
  address internal constant DiamondRouter = 0x33636D49FbefBE798e15e7F356E8DBef543CC708;

  /// @dev The address of multi path converter.
  address internal constant ConverterAddress = 0x12AF4529129303D7FbD2563E242C4a2890525912;

  /// @dev The address of proxy admin.
  ProxyAdmin internal constant proxyAdmin = ProxyAdmin(0x9B54B7703551D9d0ced177A78367560a8B2eDDA4);

  /// @dev The address of fxUSD token.
  FxUSDRegeneracy internal constant fxUSD = FxUSDRegeneracy(0x085780639CC2cACd35E474e71f4d000e2405d8f6);

  /// @dev The address of fxBASE token.
  FxUSDBasePool internal constant fxBASE = FxUSDBasePool(0x65C9A641afCEB9C0E6034e558A319488FA0FA3be);

  /// @dev The address of fxSAVE token.
  SavingFxUSD internal constant fxSAVE = SavingFxUSD(0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39);

  /// @dev The address of pool configuration.
  PoolConfiguration internal constant configuration = PoolConfiguration(0x16b334f2644cc00b85DB1A1efF0C2C395e00C28d);

  /// @dev The address of long pool manager.
  PoolManager internal constant longPoolManager = PoolManager(0x250893CA4Ba5d05626C785e8da758026928FCD24);

  /// @dev The address of wstETH long pool.
  AaveFundingPool internal constant wstETHLongPool = AaveFundingPool(0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8);

  /// @dev The address of wbtc long pool.
  AaveFundingPool internal constant wbtcLongPool = AaveFundingPool(0xAB709e26Fa6B0A30c119D8c55B887DeD24952473);

  /// @dev The address of short pool manager.
  ShortPoolManager internal constant shortPoolManager = ShortPoolManager(0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D);

  /// @dev The address of wstETH short pool.
  ShortPool internal constant wstETHShortPool = ShortPool(0x25707b9e6690B52C60aE6744d711cf9C1dFC1876);

  /// @dev The address of wbtc short pool.
  ShortPool internal constant wbtcShortPool = ShortPool(0xA0cC8162c523998856D59065fAa254F87D20A5b0);

  /*************************
   * Common mainnet tokens *
   *************************/

  /// @dev The address of WETH token.
  address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

  /// @dev The address of USDC token.
  address internal constant USDC = 0xA0B86A33e6441b8C4c8C0e1234567890AbcdEF12;

  /// @dev The address of USDT token.
  address internal constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;

  /// @dev The address of stETH token.
  address internal constant stETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;

  /// @dev The address of wstETH token.
  address internal constant wstETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;

  /// @dev Upgrades a facet.
  /// @param selector The selector of the facet to upgrade.
  /// @param facet The address of the facet to upgrade.
  function upgradeFacet(bytes4 selector, address facet) internal {
    address oldFacet = DiamondLoupeFacet(DiamondRouter).facetAddress(selector);
    IDiamond.FacetCut[] memory diamondCut = new IDiamond.FacetCut[](1);
    bytes4[] memory functionSelectors = new bytes4[](1);
    functionSelectors[0] = selector;
    if (oldFacet == address(0)) {
      diamondCut[0] = IDiamond.FacetCut({
        facetAddress: facet,
        action: IDiamond.FacetCutAction.Add,
        functionSelectors: functionSelectors
      });
    } else {
      diamondCut[0] = IDiamond.FacetCut({
        facetAddress: facet,
        action: IDiamond.FacetCutAction.Replace,
        functionSelectors: functionSelectors
      });
    }
    vm.prank(FxMultisig);
    DiamondCutFacet(DiamondRouter).diamondCut(diamondCut, address(0), "0x");
  }

  /// @dev Upgrades a proxy.
  /// @param proxy The address of the proxy to upgrade.
  /// @param implementation The address of the implementation to upgrade to.
  function upgradeProxy(address proxy, address implementation) internal {
    vm.prank(FxMultisig);
    proxyAdmin.upgrade(ITransparentUpgradeableProxy(proxy), implementation);
  }

  /// @dev Encodes a pool hint for Lido.
  /// @param pool The address of the pool.
  /// @param action The action to perform.
  /// @return encoding The encoded pool hint.
  function encodePoolHintV3Lido(address pool, uint256 action) internal pure returns (uint256 encoding) {
    uint256 poolType = 10;
    encoding = uint256(uint160(pool));
    encoding = (encoding << 2) | uint256(action);
    encoding = (encoding << 8) | uint256(poolType);
    return encoding;
  }
}
