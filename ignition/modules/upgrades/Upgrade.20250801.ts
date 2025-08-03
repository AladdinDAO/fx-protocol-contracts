import {
  LongPositionEmergencyCloseFacet__factory,
  PositionOperateFlashLoanFacetV2__factory,
  ShortPositionOperateFlashLoanFacet__factory,
} from "@/types/index";
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { Interface, ZeroAddress } from "ethers";

const getAllSignatures = (e: Interface): string[] => {
  const sigs: string[] = [];
  e.forEachFunction((func, _) => {
    sigs.push(func.selector);
  });
  return sigs;
};

export default buildModule("Upgrade20250801", (m) => {
  const admin = m.getAccount(0);

  // deploy SmartWalletWhitelist implementation
  const SmartWalletWhitelist = m.contract("SmartWalletWhitelist", [admin], {
    id: "SmartWalletWhitelist",
  });

  // deploy PoolManager implementation
  const PoolManagerImplementation = m.contract(
    "PoolManager",
    [
      m.getParameter("FxUSDProxy"),
      m.getParameter("FxUSDBasePoolProxy"),
      m.getParameter("ShortPoolManagerProxy"),
      m.getParameter("PoolConfigurationProxy"),
      SmartWalletWhitelist,
    ],
    {
      id: "PoolManagerImplementation",
    }
  );

  // deploy ShortPoolManager implementation
  const ShortPoolManagerImplementation = m.contract(
    "ShortPoolManager",
    [
      m.getParameter("FxUSDProxy"),
      m.getParameter("PoolManagerProxy"),
      m.getParameter("PoolConfigurationProxy"),
      SmartWalletWhitelist,
    ],
    {
      id: "ShortPoolManagerImplementation",
    }
  );

  // deploy PositionOperateFlashLoanFacetV2
  const PositionOperateFlashLoanFacetV2 = m.contract("PositionOperateFlashLoanFacetV2", [
    "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
    m.getParameter("PoolManagerProxy"),
    SmartWalletWhitelist,
  ]);

  // deploy ShortPositionOperateFlashLoanFacet
  const ShortPositionOperateFlashLoanFacet = m.contract("ShortPositionOperateFlashLoanFacet", [
    "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
    m.getParameter("ShortPoolManagerProxy"),
    SmartWalletWhitelist,
  ]);

  // deploy LongPositionEmergencyCloseFacet
  const LongPositionEmergencyCloseFacet = m.contract("LongPositionEmergencyCloseFacet", [
    "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
    m.getParameter("PoolManagerProxy"),
    m.getParameter("ShortPoolManagerProxy"),
    "0x12AF4529129303D7FbD2563E242C4a2890525912",
    SmartWalletWhitelist,
  ]);

  const DiamondCutFacet = m.contractAt("DiamondCutFacet", m.getParameter("Router"));
  m.call(SmartWalletWhitelist, "approveWallet", [DiamondCutFacet]);

  /*
  // upgrade facets
  m.call(DiamondCutFacet, "diamondCut", [
    [
      {
        facetAddress: PositionOperateFlashLoanFacetV2,
        action: 1,
        functionSelectors: getAllSignatures(PositionOperateFlashLoanFacetV2__factory.createInterface()),
      },
      {
        facetAddress: ShortPositionOperateFlashLoanFacet,
        action: 1,
        functionSelectors: getAllSignatures(ShortPositionOperateFlashLoanFacet__factory.createInterface()),
      },
      {
        facetAddress: LongPositionEmergencyCloseFacet,
        action: 1,
        functionSelectors: getAllSignatures(LongPositionEmergencyCloseFacet__factory.createInterface()),
      },
    ],
    ZeroAddress,
    "0x",
  ]);
  */

  return {
    SmartWalletWhitelist,
    PoolManagerImplementation,
    ShortPoolManagerImplementation,
    PositionOperateFlashLoanFacetV2,
    ShortPositionOperateFlashLoanFacet,
    LongPositionEmergencyCloseFacet,
  };
});
