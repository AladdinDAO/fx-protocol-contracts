import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { Interface, ZeroAddress } from "ethers";

import { ChainlinkPriceFeed } from "@/utils/index.ts";
import { encodeChainlinkPriceFeed, EthereumTokens } from "@/utils/index.ts";
import {
  DiamondCutFacet__factory,
  DiamondLoupeFacet__factory,
  OwnershipFacet__factory,
  PositionOperateFacet__factory,
  RouterManagementFacet__factory,
  SavingFxUSDFacet__factory,
} from "@/types/index.ts";
import { MultiPathConverter } from "@/types/contracts/helpers/converter/index.ts";

const getAllSignatures = (e: Interface): string[] => {
  const sigs: string[] = [];
  e.forEachFunction((func, _) => {
    sigs.push(func.selector);
  });
  return sigs;
};

export default buildModule("Upgrade20251030", (m) => {
  const owner = m.getAccount(0);

  // deploy PositionOperateFacet
  const PositionOperateFacet = m.contract("PositionOperateFacet", []);

  // deploy router
  const diamondCuts = [
    {
      facetAddress: m.getParameter("DiamondCutFacet"),
      action: 0,
      functionSelectors: getAllSignatures(DiamondCutFacet__factory.createInterface()),
    },
    {
      facetAddress: m.getParameter("DiamondLoupeFacet"),
      action: 0,
      functionSelectors: getAllSignatures(DiamondLoupeFacet__factory.createInterface()),
    },
    {
      facetAddress: m.getParameter("OwnershipFacet"),
      action: 0,
      functionSelectors: getAllSignatures(OwnershipFacet__factory.createInterface()),
    },
    {
      facetAddress: m.getParameter("RouterManagementFacet"),
      action: 0,
      functionSelectors: getAllSignatures(RouterManagementFacet__factory.createInterface()),
    },
    {
      facetAddress: PositionOperateFacet,
      action: 0,
      functionSelectors: getAllSignatures(PositionOperateFacet__factory.createInterface()),
    },
  ];
  // deploy Router
  const FxMintRouter = m.contract(
    "Diamond",
    [
      diamondCuts,
      {
        owner: owner,
        init: ZeroAddress,
        initCalldata: "0x",
      },
    ],
    { id: "FxMintRouter" }
  );
  // config parameters
  const RouterManagementFacet = m.contractAt("RouterManagementFacet", FxMintRouter);
  m.call(RouterManagementFacet, "approveTarget", [
    m.getParameter("MultiPathConverter"),
    m.getParameter("MultiPathConverter"),
  ]);
  m.call(RouterManagementFacet, "updateRevenuePool", [m.getParameter("RevenuePool")]);
  const OwnershipFacet = m.contractAt("OwnershipFacet", FxMintRouter);
  m.call(OwnershipFacet, "transferOwnership", ["0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF"]);

  return {
    FxMintRouter,
  };
});
