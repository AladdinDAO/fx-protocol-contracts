import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { KatanaTokens } from "@/utils/index";

import ProxyAdminModule from "./ProxyAdmin";
import ProxiesModule from "./Proxies";

export default buildModule("FxUSD", (m) => {
  const admin = m.getAccount(0);

  const { fx: FxProxyAdmin } = m.useModule(ProxyAdminModule);
  const { FxUSDProxy, PoolManagerProxy, PegKeeperProxy } = m.useModule(ProxiesModule);

  // deploy FxUSD implementation and initialize FxUSD proxy
  const FxUSDImplementation = m.contract(
    "FxUSDRegeneracy",
    [PoolManagerProxy, KatanaTokens.USDC.address, PegKeeperProxy],
    { id: "FxUSDImplementation" },
  );

  const FxUSDInitializer = m.encodeFunctionCall(FxUSDImplementation, "initialize", [
    "f(x) USD",
    "fxUSD",
    m.getParameter("FxUSDInitSupply"),
    m.getParameter("FxUSDInitRecipient"),
    admin,
  ]);
  m.call(FxProxyAdmin, "upgradeAndCall", [FxUSDProxy, FxUSDImplementation, FxUSDInitializer], {
    id: "FxUSDProxy_upgradeAndCall",
  });

  return {
    FxUSDProxy,
  };
});
