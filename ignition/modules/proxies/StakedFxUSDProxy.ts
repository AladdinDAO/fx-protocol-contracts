import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import ProxyAdminModule from "../ProxyAdmin";
import EmptyContractModule from "../EmptyContract";

export default buildModule("StakedFxUSDProxy", (m) => {
  const { fx: ProxyAdmin } = m.useModule(ProxyAdminModule);
  const { EmptyContract } = m.useModule(EmptyContractModule);

  const StakedFxUSDProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, ProxyAdmin, "0x"]);

  return { StakedFxUSDProxy };
});
