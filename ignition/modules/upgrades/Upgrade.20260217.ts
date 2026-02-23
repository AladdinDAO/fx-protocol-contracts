import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { EthereumTokens } from "@/utils/index.ts";

export default buildModule("Upgrade20260217", (m) => {
  // deploy FxUSDRegeneracy implementation
  const FxUSDRegeneracyImplementation = m.contract("FxUSDRegeneracy", [
    m.getParameter("PoolManagerProxy"),
    EthereumTokens.USDC.address,
    m.getParameter("PegKeeperProxy"),
  ]);

  return {
    FxUSDRegeneracyImplementation,
  };
});
