import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroAddress } from "ethers";

export default buildModule("ProxyAdmin", (m) => {
  const fxAdmin = m.contract("ProxyAdmin", [], { id: "FxProxyAdmin" });
  return { fx: fxAdmin };
});
