import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroAddress } from "ethers";

import ProxyAdminModule from "../ProxyAdmin";
import EmptyContractModule from "../EmptyContract";

export default buildModule("FxUSDProxy", (m) => {
  const { fx: ProxyAdmin } = m.useModule(ProxyAdminModule);
  const { EmptyContract } = m.useModule(EmptyContractModule);

  let FxUSDProxy;
  FxUSDProxy = m.contractAt("TransparentUpgradeableProxy", m.getParameter("FxUSDProxy", ZeroAddress));
  if (FxUSDProxy.address === ZeroAddress) {
    FxUSDProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, ProxyAdmin, "0x"]);
  }

  return { FxUSDProxy };
});
