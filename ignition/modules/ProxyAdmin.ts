import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroAddress } from "ethers";

export default buildModule("ProxyAdmin", (m) => {
  let fxAdmin: any = m.contractAt("ProxyAdmin", m.getParameter("Fx", ZeroAddress), { id: "FxProxyAdmin" });
  if (fxAdmin.address === ZeroAddress) {
    fxAdmin = m.contract("ProxyAdmin", [], { id: "FxProxyAdmin" });
  }
  let customAdmin: any = m.contractAt("ProxyAdmin", m.getParameter("Custom", ZeroAddress), { id: "CustomProxyAdmin" });
  if (customAdmin.address === ZeroAddress) {
    customAdmin = m.contract("ProxyAdmin", [], { id: "CustomProxyAdmin" });
  }
  return { fx: fxAdmin, custom: customAdmin };
});
