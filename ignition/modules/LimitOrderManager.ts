import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroHash } from "ethers";

export default buildModule("LimitOrderManager", (m) => {
  const deployer = m.getAccount(0);
  const LimitOrderManagerImplementation = m.contract(
    "LimitOrderManager",
    [m.getParameter("PoolManagerProxy"), m.getParameter("ShortPoolManagerProxy"), m.getParameter("FxUSDProxy")],
    { id: "LimitOrderManagerImplementation" }
  );
  const LimitOrderManagerInitializer = m.encodeFunctionCall(LimitOrderManagerImplementation, "initialize", [
    deployer,
    m.getParameter("Treasury"),
  ]);
  const LimitOrderManagerProxy = m.contract(
    "TransparentUpgradeableProxy",
    [LimitOrderManagerImplementation, m.getParameter("FxProxyAdmin"), LimitOrderManagerInitializer],
    { id: "LimitOrderManagerProxy" }
  );
  const LimitOrderManager = m.contractAt("LimitOrderManager", LimitOrderManagerProxy);
  m.call(LimitOrderManager, "grantRole", [ZeroHash, m.getParameter("Treasury")], {
    id: "grantRole_DEFAULT_ADMIN_ROLE",
  });
  return { LimitOrderManager };
});
