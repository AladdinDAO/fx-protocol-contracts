import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { Interface, ZeroAddress } from "ethers";

import {
  DiamondCutFacet__factory,
  DiamondLoupeFacet__factory,
  FlashLoanCallbackFacet__factory,
  FlashSwapFacet__factory,
  OwnershipFacet__factory,
  RouterManagementFacet__factory,
} from "@/types/index";

import ERC2535Module from "./ERC2535";
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
  const { FxUSDProxy } = m.useModule(FxProtocolModule);

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
      facetAddress: facets.FlashSwapFacet,
      action: 0,
      functionSelectors: getAllSignatures(FlashSwapFacet__factory.createInterface()),
    },
  ];

  const Router = m.contract("Diamond", [
    diamondCuts,
    {
      owner: owner,
      init: ZeroAddress,
      initCalldata: "0x",
    },
  ]);

  const MIGRATOR_ROLE = m.staticCall(FxUSDProxy, "MIGRATOR_ROLE");
  m.call(FxUSDProxy, "grantRole", [MIGRATOR_ROLE, Router]);

  return { Router };
});
