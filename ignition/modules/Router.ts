import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { id, Interface, ZeroAddress } from "ethers";

import {
  DiamondCutFacet__factory,
  DiamondLoupeFacet__factory,
  FlashLoanCallbackFacet__factory,
  PositionOperateFlashLoanFacet__factory,
  MigrateFacet__factory,
  OwnershipFacet__factory,
  RouterManagementFacet__factory,
  FxUSDBasePoolFacet__factory,
} from "@/types/index";

import ERC2535Module from "./ERC2535";
import TokenConverterModule from "./TokenConverter";
import FxProtocolModule from "./FxProtocol";

const getAllSignatures = (e: Interface): string[] => {
  const sigs: string[] = [];
  e.forEachFunction((func, _) => {
    sigs.push(func.selector);
  });
  return sigs;
};

export default buildModule("Router", (m) => {
  const owner = m.getAccount(0);
  const facets = m.useModule(ERC2535Module);
  const { MultiPathConverter } = m.useModule(TokenConverterModule);
  const { PoolManagerProxy } = m.useModule(FxProtocolModule);

  const diamondCuts = [
    {
      facetAddress: facets.DiamondCutFacet,
      action: 0,
      functionSelectors: getAllSignatures(DiamondCutFacet__factory.createInterface()),
    },
    {
      facetAddress: facets.DiamondLoupeFacet,
      action: 0,
      functionSelectors: getAllSignatures(DiamondLoupeFacet__factory.createInterface()),
    },
    {
      facetAddress: facets.OwnershipFacet,
      action: 0,
      functionSelectors: getAllSignatures(OwnershipFacet__factory.createInterface()),
    },
    {
      facetAddress: facets.RouterManagementFacet,
      action: 0,
      functionSelectors: getAllSignatures(RouterManagementFacet__factory.createInterface()),
    },
    {
      facetAddress: facets.FlashLoanCallbackFacet,
      action: 0,
      functionSelectors: getAllSignatures(FlashLoanCallbackFacet__factory.createInterface()),
    },
    {
      facetAddress: facets.PositionOperateFlashLoanFacet,
      action: 0,
      functionSelectors: getAllSignatures(PositionOperateFlashLoanFacet__factory.createInterface()),
    },
    {
      facetAddress: facets.MigrateFacet,
      action: 0,
      functionSelectors: getAllSignatures(MigrateFacet__factory.createInterface()),
    },
    {
      facetAddress: facets.FxUSDBasePoolFacet,
      action: 0,
      functionSelectors: getAllSignatures(FxUSDBasePoolFacet__factory.createInterface()),
    },
  ];

  // deploy Router
  const Router = m.contract("Diamond", [
    diamondCuts,
    {
      owner: owner,
      init: ZeroAddress,
      initCalldata: "0x",
    },
  ]);
  // deploy ReservePool
  const RevenuePool = m.contract("RevenuePool", [m.getParameter("Treasury"), m.getParameter("Treasury"), owner]);

  // config parameters
  const RouterManagementFacet = m.contractAt("RouterManagementFacet", Router);
  m.call(RouterManagementFacet, "approveTarget", [MultiPathConverter, MultiPathConverter]);
  m.call(RouterManagementFacet, "updateRevenuePool", [RevenuePool]);

  m.call(PoolManagerProxy, "grantRole", [id("OPERATOR_ROLE"), Router]);

  return { Router, RevenuePool };
});
