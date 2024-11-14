import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import PoolManagerProxyModule from "./proxies/PoolManagerProxy";
import StakedFxUSDProxyModule from "./proxies/StakedFxUSDProxy";
import PegKeeperProxyModule from "./proxies/PegKeeperProxy";
import FxUSDProxyModule from "./proxies/FxUSDProxy";

export default buildModule("FxProtocolProxies", (m) => {
  const { PoolManagerProxy } = m.useModule(PoolManagerProxyModule);
  const { StakedFxUSDProxy } = m.useModule(StakedFxUSDProxyModule);
  const { PegKeeperProxy } = m.useModule(PegKeeperProxyModule);
  const { FxUSDProxy } = m.useModule(FxUSDProxyModule);

  return { PoolManagerProxy, StakedFxUSDProxy, PegKeeperProxy, FxUSDProxy };
});
