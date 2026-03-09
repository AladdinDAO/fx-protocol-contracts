import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroHash } from "ethers";

const DEFAULT_ADMIN_ROLE = ZeroHash;

export default buildModule("KatanaTransferAuthority3", (m) => {
  const admin = m.getAccount(0);
  const Treasury = m.getParameter("Treasury");
  const FxUSDBasePoolGaugeProxyAddress = m.getParameter("FxUSDBasePoolGaugeProxy");

  const FxUSDBasePoolGauge = m.contractAt("LinearMultipleRewardDistributor", FxUSDBasePoolGaugeProxyAddress);

  const grantRole = m.call(FxUSDBasePoolGauge, "grantRole", [DEFAULT_ADMIN_ROLE, Treasury], {
    id: "FxUSDBasePoolGauge_grantRole",
  });
  m.call(FxUSDBasePoolGauge, "renounceRole", [DEFAULT_ADMIN_ROLE, admin], {
    id: "FxUSDBasePoolGauge_renounceRole",
    after: [grantRole],
  });

  return {};
});
