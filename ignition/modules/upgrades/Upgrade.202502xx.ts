import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { Interface, ZeroAddress } from "ethers";

import { MorphoFlashLoanCallbackFacet__factory, PositionOperateFlashLoanFacetV2__factory } from "@/types/index";
import { ChainlinkPriceFeed, encodeChainlinkPriceFeed, EthereumTokens } from "@/utils/index";

const getAllSignatures = (e: Interface): string[] => {
  const sigs: string[] = [];
  e.forEachFunction((func, _) => {
    sigs.push(func.selector);
  });
  return sigs;
};

export default buildModule("Upgrade202502xx", (m) => {
  // deploy PoolManager implementation
  const PoolManagerImplementation = m.contract(
    "PoolManager",
    [m.getParameter("FxUSDProxy"), m.getParameter("FxUSDBasePoolProxy"), m.getParameter("PegKeeperProxy")],
    {
      id: "PoolManagerImplementation",
    }
  );

  // deploy AaveFundingPool implementation
  const AaveFundingPoolImplementation = m.contract(
    "AaveFundingPool",
    [m.getParameter("PoolManagerProxy"), m.getParameter("LendingPool"), m.getParameter("BaseAsset")],
    { id: "AaveFundingPoolImplementation" }
  );

  // deploy FxUSDBasePool implementation
  const FxUSDBasePoolImplementation = m.contract(
    "FxUSDBasePool",
    [
      m.getParameter("PoolManagerProxy"),
      m.getParameter("PegKeeperProxy"),
      m.getParameter("FxUSDProxy"),
      EthereumTokens.USDC.address,
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["USDC-USD"].feed,
        ChainlinkPriceFeed.ethereum["USDC-USD"].scale,
        ChainlinkPriceFeed.ethereum["USDC-USD"].heartbeat
      ),
    ],
    { id: "FxUSDBasePoolImplementation" }
  );

  // deploy PositionOperateFlashLoanFacetV2
  const PositionOperateFlashLoanFacetV2 = m.contract("PositionOperateFlashLoanFacetV2", [
    "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
    m.getParameter("PoolManagerProxy"),
  ]);

  // deploy MorphoFlashLoanCallbackFacet
  const MorphoFlashLoanCallbackFacet = m.contract("MorphoFlashLoanCallbackFacet", [
    "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
  ]);

  // upgrade facets
  const diamondCutFacet = m.contractAt("DiamondCutFacet", m.getParameter("Router"));
  /*m.call(diamondCutFacet, "diamondCut", [
    [
      {
        facetAddress: PositionOperateFlashLoanFacetV2,
        action: 0,
        functionSelectors: getAllSignatures(PositionOperateFlashLoanFacetV2__factory.createInterface()),
      },
      {
        facetAddress: MorphoFlashLoanCallbackFacet,
        action: 0,
        functionSelectors: getAllSignatures(MorphoFlashLoanCallbackFacet__factory.createInterface()),
      },
    ],
    ZeroAddress,
    "0x",
  ]);
  */

  return {
    PositionOperateFlashLoanFacetV2,
    MorphoFlashLoanCallbackFacet,
    PoolManagerImplementation,
    AaveFundingPoolImplementation,
    FxUSDBasePoolImplementation,
  };
});
