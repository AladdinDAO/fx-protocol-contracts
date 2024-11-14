import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroAddress } from "ethers";

export default buildModule("ProxyAdmin", (m) => {
  const admin = m.contractAt("ProxyAdmin", m.getParameter("Fx", ZeroAddress));
  if (admin.address === ZeroAddress) {
    return { fx: m.contract("ProxyAdmin", []) };
  } else {
    return { fx: admin };
  }
});
