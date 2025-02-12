import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import EmptyContractModule from "./EmptyContract";
import ProxyAdminModule from "./ProxyAdmin";
import { Interface, ZeroAddress } from "ethers";
import { SavingFxUSDFacet__factory } from "@/types/index";

const getAllSignatures = (e: Interface): string[] => {
  const sigs: string[] = [];
  e.forEachFunction((func, _) => {
    sigs.push(func.selector);
  });
  return sigs;
};

export default buildModule("FxSave", (m) => {
  const admin = m.getAccount(0);
  const { fx: FxProxyAdmin, custom: CustomProxyAdmin } = m.useModule(ProxyAdminModule);
  const { EmptyContract } = m.useModule(EmptyContractModule);

  // deploy FxUSDBasePool Gauge
  const LiquidityGaugeImplementation = m.contractAt("ILiquidityGauge", m.getParameter("LiquidityGaugeImplementation"));
  const LiquidityGaugeInitializer = m.encodeFunctionCall(LiquidityGaugeImplementation, "initialize", [
    m.getParameter("fxBase"),
  ]);
  const FxUSDBasePoolGaugeProxy = m.contract(
    "TransparentUpgradeableProxy",
    [LiquidityGaugeImplementation, FxProxyAdmin, LiquidityGaugeInitializer],
    {
      id: "FxUSDBasePoolGaugeProxy",
    }
  );

  // deploy SavingFxUSDProxy
  const SavingFxUSDProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], {
    id: "SavingFxUSDProxy",
  });
  // deploy RewardHarvester
  const RewardHarvester = m.contract("RewardHarvester", [SavingFxUSDProxy]);
  // deploy PoolManager implementation and initialize PoolManager proxy
  const SavingFxUSDImplementation = m.contract(
    "SavingFxUSD",
    [m.getParameter("fxBase"), m.getParameter("fxBaseGauge")],
    {
      id: "SavingFxUSDImplementation",
    }
  );
  const SavingFxUSDInitializer = m.encodeFunctionCall(SavingFxUSDImplementation, "initialize", [
    admin,
    {
      name: m.getParameter("Name"),
      symbol: m.getParameter("Symbol"),
      pid: m.getParameter("pid"),
      threshold: m.getParameter("Threshold"),
      treasury: m.getParameter("Treasury"),
      harvester: RewardHarvester,
    },
  ]);
  const SavingFxUSDProxyUpgradeAndInitializeCall = m.call(
    CustomProxyAdmin,
    "upgradeAndCall",
    [SavingFxUSDProxy, SavingFxUSDImplementation, SavingFxUSDInitializer],
    {
      id: "SavingFxUSDProxy_upgradeAndCall",
    }
  );
  // change admin
  const changeProxyAdmin = m.call(CustomProxyAdmin, "changeProxyAdmin", [SavingFxUSDProxy, FxProxyAdmin], {
    id: "SavingFxUSDProxy_changeProxyAdmin",
    after: [SavingFxUSDProxyUpgradeAndInitializeCall],
  });

  // deploy SavingFxUSDFacet
  const SavingFxUSDFacet = m.contract("SavingFxUSDFacet", [m.getParameter("fxBase"), SavingFxUSDProxy]);
  const diamondCutFacet = m.contractAt("DiamondCutFacet", m.getParameter("Router"));
  /*m.call(
    diamondCutFacet,
    "diamondCut",
    [
      [
        {
          facetAddress: SavingFxUSDFacet,
          action: 0,
          functionSelectors: getAllSignatures(SavingFxUSDFacet__factory.createInterface()),
        },
      ],
      ZeroAddress,
      "0x",
    ],
    { after: [changeProxyAdmin] }
  );
  */

  return {
    RewardHarvester,
    FxUSDBasePoolGaugeProxy,
    SavingFxUSDProxy: m.contractAt("SavingFxUSD", SavingFxUSDProxy, { id: "fxSAVE" }),
    SavingFxUSDFacet,
  };
});
