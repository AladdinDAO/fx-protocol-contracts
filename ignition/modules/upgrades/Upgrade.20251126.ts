import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { EthereumTokens } from "@/utils/index.ts";

export default buildModule("Upgrade20251126", (m) => {
  // deploy FxUSDBasePool implementation
  const FxUSDBasePoolImplementation = m.contract(
    "FxUSDBasePool",
    [
      m.getParameter("PoolManagerProxy"),
      m.getParameter("PegKeeperProxy"),
      m.getParameter("FxUSDProxy"),
      EthereumTokens.USDC.address,
      m.getParameter("FxUSDPriceOracleProxy"),
    ],
    { id: "FxUSDBasePoolImplementation" }
  );

  return {
    FxUSDBasePoolImplementation,
  };
});
