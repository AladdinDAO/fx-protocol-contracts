import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import FxProtocolModule from "./FxProtocol";
import TokenConverterModule from "./TokenConverter";

const BalancerVault = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

export default buildModule("ERC2535", (m) => {
  const { PoolManagerProxy, FxUSDBasePoolProxy, FxUSDBasePoolGaugeProxy } = m.useModule(FxProtocolModule);
  const { MultiPathConverter } = m.useModule(TokenConverterModule);

  // deploy DiamondCutFacet, DiamondLoupeFacet, and OwnershipFacet
  const DiamondCutFacet = m.contract("DiamondCutFacet", []);
  const DiamondLoupeFacet = m.contract("DiamondLoupeFacet", []);
  const OwnershipFacet = m.contract("OwnershipFacet", []);

  // deploy
  const RouterManagementFacet = m.contract("RouterManagementFacet", []);

  // deploy FlashLoanCallbackFacet
  const FlashLoanCallbackFacet = m.contract("FlashLoanCallbackFacet", [BalancerVault]);

  // deploy PositionOperateFlashLoanFacet
  const PositionOperateFlashLoanFacet = m.contract("PositionOperateFlashLoanFacet", [
    BalancerVault,
    PoolManagerProxy,
    MultiPathConverter,
  ]);

  // deploy MigrateFacet
  const MigrateFacet = m.contract("MigrateFacet", [BalancerVault, PoolManagerProxy, MultiPathConverter]);

  // deploy FxUSDBasePoolFacet
  const FxUSDBasePoolFacet = m.contract("FxUSDBasePoolFacet", [
    PoolManagerProxy,
    FxUSDBasePoolProxy,
    FxUSDBasePoolGaugeProxy,
  ]);

  return {
    DiamondCutFacet,
    DiamondLoupeFacet,
    OwnershipFacet,

    RouterManagementFacet,

    FlashLoanCallbackFacet,
    PositionOperateFlashLoanFacet,
    MigrateFacet,
    FxUSDBasePoolFacet,
  };
});
