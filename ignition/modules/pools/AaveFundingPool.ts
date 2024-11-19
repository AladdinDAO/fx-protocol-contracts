import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import FxProtocolModule from "../FxProtocol";

export default buildModule("AaveFundingPool", (m) => {
  const { PoolManagerProxy } = m.useModule(FxProtocolModule);
  const AaveFundingPoolImplementation = m.contract(
    "AaveFundingPool",
    [PoolManagerProxy, m.getParameter("LendingPool"), m.getParameter("BaseAsset")],
    { id: "AaveFundingPoolImplementation" }
  );

  return { AaveFundingPoolImplementation };
});
