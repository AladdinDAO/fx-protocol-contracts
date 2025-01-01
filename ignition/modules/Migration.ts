import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { id } from "ethers";

import FxProtocolModule from "./FxProtocol";
import ProxyAdminModule from "./ProxyAdmin";
import RouterModule from "./Router";

export default buildModule("Migration", (m) => {
  const { fx: ProxyAdmin } = m.useModule(ProxyAdminModule);
  const { FxUSDProxy } = m.useModule(FxProtocolModule);
  const { Router } = m.useModule(RouterModule);

  const WstETHMarketImplementation = m.contract("MarketV2", ["0xED803540037B0ae069c93420F89Cd653B6e3Df1f"], {
    id: "WstETHMarketImplementation",
  });
  const SfrxETHMarketImplementation = m.contract("MarketV2", ["0xcfEEfF214b256063110d3236ea12Db49d2dF2359"], {
    id: "SfrxETHMarketImplementation",
  });
  const WstETHMarketProxy = m.contractAt("MarketV2", "0xAD9A0E7C08bc9F747dF97a3E7E7f620632CB6155", {
    id: "WstETHMarketProxy",
  });
  const SfrxETHMarketProxy = m.contractAt("MarketV2", "0x714B853b3bA73E439c652CfE79660F329E6ebB42", {
    id: "SfrxETHMarketProxy",
  });

  /*
  m.call(ProxyAdmin, "upgrade", [WstETHMarketProxy, WstETHMarketImplementation], {
    id: "WstETHMarketV2Proxy_upgrade",
  });
  m.call(ProxyAdmin, "upgrade", [SfrxETHMarketProxy, SfrxETHMarketImplementation], {
    id: "SfrxETHMarketV2Proxy_upgrade",
  });

  m.call(WstETHMarketProxy, "grantRole", [id("MIGRATOR_ROLE"), Router]);
  m.call(SfrxETHMarketProxy, "grantRole", [id("MIGRATOR_ROLE"), Router]);
  m.call(FxUSDProxy, "grantRole", [id("MIGRATOR_ROLE"), Router]);
  */

  return { WstETHMarketProxy, SfrxETHMarketProxy, WstETHMarketImplementation, SfrxETHMarketImplementation };
});
