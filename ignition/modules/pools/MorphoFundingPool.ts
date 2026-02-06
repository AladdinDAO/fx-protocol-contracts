import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import FxProtocolModule from "../FxProtocol";

export default buildModule("MorphoFundingPool", (m) => {
  const { PoolManagerProxy, PoolConfiguration } = m.useModule(FxProtocolModule);
  const MorphoFundingPoolImplementation = m.contract("MorphoFundingPool", [PoolManagerProxy, PoolConfiguration], {
    id: "MorphoFundingPoolImplementation",
  });

  return { MorphoFundingPoolImplementation };
});
