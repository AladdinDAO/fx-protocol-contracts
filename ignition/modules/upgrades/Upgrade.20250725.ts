import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { EthereumTokens } from "@/utils/index";

import ProxyAdminModule from "../ProxyAdmin";
import { ethers } from "hardhat";
import { ZeroAddress } from "ethers";

export default buildModule("Upgrade20250725", (m) => {
  const admin = m.getAccount(0);
  const { fx: FxProxyAdmin } = m.useModule(ProxyAdminModule);

  const WBTCLongPool = m.contractAt("AaveFundingPool", m.getParameter("WBTCLongPoolProxy"), {
    id: "WBTCLongPool",
  });

  // deploy InverseWBTCPriceOracle
  const InverseWBTCPriceOracle = m.contract("InversePriceOracle", [m.getParameter("WBTCPriceOracle"), ZeroAddress], {
    id: "InverseWBTCPriceOracle",
  });

  // deploy CreditNote for WBTC
  const CreditNoteImplementation = m.contractAt("CreditNote", m.getParameter("CreditNoteImplementation"), {
    id: "CreditNoteImplementation",
  });
  const CreditNoteInitializer = m.encodeFunctionCall(CreditNoteImplementation, "initialize", [
    "WBTC Credit Note",
    "WBTC-CN",
    8,
  ]);
  const CreditNoteProxy = m.contract(
    "TransparentUpgradeableProxy",
    [CreditNoteImplementation, FxProxyAdmin, CreditNoteInitializer],
    {
      id: "CreditNoteProxy",
    }
  );
  const CreditNote = m.contractAt("CreditNote", CreditNoteProxy);

  // deploy ShortPool for WBTC
  const ShortPoolImplementation = m.contractAt("ShortPool", m.getParameter("ShortPoolImplementation"), {
    id: "ShortPoolImplementation",
  });
  const ShortPoolInitializer = m.encodeFunctionCall(ShortPoolImplementation, "initialize", [
    admin,
    "f(x) WBTC Short",
    "sWBTC",
    InverseWBTCPriceOracle,
    EthereumTokens.WBTC.address,
    CreditNote,
  ]);
  const WBTCShortPoolProxy = m.contract(
    "TransparentUpgradeableProxy",
    [ShortPoolImplementation, FxProxyAdmin, ShortPoolInitializer],
    {
      id: "WBTCShortPoolProxy",
    }
  );
  const WBTCShortPool = m.contractAt("ShortPool", WBTCShortPoolProxy, { id: "WBTCShortPool" });

  m.call(WBTCShortPool, "updateCounterparty", [WBTCLongPool]);
  m.call(WBTCShortPool, "updateDebtRatioRange", [90909090909090909n, 866666666666666666n]);
  m.call(WBTCShortPool, "updateRebalanceRatios", [ethers.parseEther("0.88"), ethers.parseUnits("0.025", 9)]);
  m.call(WBTCShortPool, "updateLiquidateRatios", [ethers.parseEther("0.95"), ethers.parseUnits("0.04", 9)]);

  return {
    InverseWBTCPriceOracle,
    WBTCShortPool,
  };
});
