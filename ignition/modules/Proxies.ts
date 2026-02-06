import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroAddress } from "ethers";

import { KatanaTokens } from "@/utils/index";

import EmptyContractModule from "./EmptyContract";
import ProxyAdminModule from "./ProxyAdmin";
import FxUSDPriceOracleModule from "./FxUSDPriceOracle";

export default buildModule("Proxies", (m) => {
  const { fx: FxProxyAdmin } = m.useModule(ProxyAdminModule);
  const { EmptyContract } = m.useModule(EmptyContractModule);

  // deploy PoolManagerProxy
  const PoolManagerProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, FxProxyAdmin, "0x"], {
    id: "PoolManagerProxy",
  });
  // deploy ShortPoolManagerProxy
  const ShortPoolManagerProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, FxProxyAdmin, "0x"], {
    id: "ShortPoolManagerProxy",
  });
  // deploy PegKeeperProxy
  const PegKeeperProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, FxProxyAdmin, "0x"], {
    id: "PegKeeperProxy",
  });
  // deploy FxUSDBasePoolProxy
  const FxUSDBasePoolProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, FxProxyAdmin, "0x"], {
    id: "FxUSDBasePoolProxy",
  });
  // deploy pool configuration proxy
  const PoolConfigurationProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, FxProxyAdmin, "0x"], {
    id: "PoolConfigurationProxy",
  });
  // deploy FxUSDProxy
  const FxUSDProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, FxProxyAdmin, "0x"], {
    id: "FxUSDProxy",
  });

  return {
    PoolManagerProxy,
    FxUSDBasePoolProxy,
    PegKeeperProxy,
    FxUSDProxy,
    ShortPoolManagerProxy,
    PoolConfigurationProxy,
  };
});
