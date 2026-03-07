import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { EthereumTokens } from "@/utils/tokens";

import FxProtocolModule from "./FxProtocol";
import PriceOracleModule from "./PriceOracle";
import ProxyAdminModule from "./ProxyAdmin";
import MorphoFundingPoolModule from "./pools/MorphoFundingPool";
import WBTCPoolModule from "./pools/WBTCPool";
import WeETHPoolModule from "./pools/WeETHPool";
import { ethers, Interface, ZeroAddress } from "ethers";
import {
  DiamondCutFacet__factory,
  DiamondLoupeFacet__factory,
  FxUSDBasePoolV2Facet__factory,
  OwnershipFacet__factory,
  PositionOperateFacet__factory,
  RouterManagementFacet__factory,
} from "@/types/index";
import ShortPoolManager from "./ShortPoolManager";
import EmptyContract from "./EmptyContract";
import TokenConverterModule from "./TokenConverter";

const getAllSignatures = (e: Interface): string[] => {
  const sigs: string[] = [];
  e.forEachFunction((func, _) => {
    sigs.push(func.selector);
  });
  return sigs;
};

export default buildModule("KatanaFxMint", (m) => {
  const admin = m.getAccount(0);
  const { fx: ProxyAdmin } = m.useModule(ProxyAdminModule);
  const { MorphoFundingPoolImplementation } = m.useModule(MorphoFundingPoolModule);
  const { ETHPriceOracle, WBTCPriceOracle } = m.useModule(PriceOracleModule);
  const { PoolManagerProxy, ShortPoolManagerProxy, RevenuePool, FxUSDProxy, PoolConfiguration, FxUSDBasePoolProxy } =
    m.useModule(FxProtocolModule);
  const { WBTCPool } = m.useModule(WBTCPoolModule);
  const { WeETHPool } = m.useModule(WeETHPoolModule);
  const { MultiPathConverter } = m.useModule(TokenConverterModule);

  // deploy PositionOperateFacet
  const PositionOperateFacet = m.contract("PositionOperateFacet", [
    FxUSDProxy,
    PoolManagerProxy,
    ShortPoolManagerProxy,
    PoolConfiguration,
  ]);

  // deploy router
  const DiamondCutFacet = m.contract("DiamondCutFacet", []);
  const DiamondLoupeFacet = m.contract("DiamondLoupeFacet", []);
  const OwnershipFacet = m.contract("OwnershipFacet", []);
  const RouterManagementFacet = m.contract("RouterManagementFacet", []);
  const FxUSDBasePoolV2Facet = m.contract("FxUSDBasePoolV2Facet", [FxUSDBasePoolProxy]);
  const diamondCuts = [
    {
      facetAddress: DiamondCutFacet,
      action: 0,
      functionSelectors: getAllSignatures(DiamondCutFacet__factory.createInterface()),
    },
    {
      facetAddress: DiamondLoupeFacet,
      action: 0,
      functionSelectors: getAllSignatures(DiamondLoupeFacet__factory.createInterface()),
    },
    {
      facetAddress: OwnershipFacet,
      action: 0,
      functionSelectors: getAllSignatures(OwnershipFacet__factory.createInterface()),
    },
    {
      facetAddress: RouterManagementFacet,
      action: 0,
      functionSelectors: getAllSignatures(RouterManagementFacet__factory.createInterface()),
    },
    {
      facetAddress: PositionOperateFacet,
      action: 0,
      functionSelectors: getAllSignatures(PositionOperateFacet__factory.createInterface()),
    },
    {
      facetAddress: FxUSDBasePoolV2Facet,
      action: 0,
      functionSelectors: getAllSignatures(FxUSDBasePoolV2Facet__factory.createInterface()),
    },
  ];
  // deploy Router
  const FxMintRouter = m.contract(
    "Diamond",
    [
      diamondCuts,
      {
        owner: admin,
        init: ZeroAddress,
        initCalldata: "0x",
      },
    ],
    { id: "FxMintRouter" },
  );
  // config parameters
  const RouterManagement = m.contractAt("RouterManagementFacet", FxMintRouter, { id: "RouterManagement" });
  m.call(RouterManagement, "approveTarget", [MultiPathConverter, MultiPathConverter]);
  m.call(RouterManagement, "updateRevenuePool", [RevenuePool]);
  /*
  const Ownership = m.contractAt("OwnershipFacet", FxMintRouter);
  m.call(Ownership, "transferOwnership", [""]);
  */

  return {
    FxMintRouter,
    ProxyAdmin,
    MorphoFundingPoolImplementation,
    ETHPriceOracle,
    WBTCPriceOracle,
    PoolManagerProxy,
    RevenuePool,
    WBTCPool,
    WeETHPool,
  };
});
