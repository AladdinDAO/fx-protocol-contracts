import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("KatanaTransferAuthority2", (m) => {
  const Treasury = m.getParameter("Treasury");
  const ETHPriceOracleAddress = m.getParameter("ETHPriceOracle");
  const WBTCPriceOracleAddress = m.getParameter("WBTCPriceOracle");
  const WeETHRateProviderAddress = m.getParameter("WeETHRateProvider");

  const ETHPriceOracle = m.contractAt("ETHPriceOracle", ETHPriceOracleAddress);
  const WBTCPriceOracle = m.contractAt("WBTCPriceOracle", WBTCPriceOracleAddress);
  const WeETHRateProvider = m.contractAt("WeETHRateProvider", WeETHRateProviderAddress);

  m.call(ETHPriceOracle, "transferOwnership", [Treasury], {
    id: "ETHPriceOracle_transferOwnership",
  });

  m.call(WBTCPriceOracle, "transferOwnership", [Treasury], {
    id: "WBTCPriceOracle_transferOwnership",
  });

  m.call(WeETHRateProvider, "transferOwnership", [Treasury], {
    id: "WeETHRateProvider_transferOwnership",
  });

  return {};
});
