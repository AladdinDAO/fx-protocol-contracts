import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { EthereumTokens } from "@/utils/tokens";

import FxProtocolModule from "../FxProtocol";
import PriceOracleModule from "../PriceOracle";
import ProxyAdminModule from "../ProxyAdmin";
import AaveFundingPoolModule from "./AaveFundingPool";

export default buildModule("WstETHPool", (m) => {
  const admin = m.getAccount(0);
  const { fx: ProxyAdmin } = m.useModule(ProxyAdminModule);
  const { AaveFundingPool } = m.useModule(AaveFundingPoolModule);
  const { StETHPriceOracle } = m.useModule(PriceOracleModule);
  const { PoolManagerProxy, SfxUSDRewarder } = m.useModule(FxProtocolModule);

  // deploy WstETHPool proxy
  const WstETHPoolInitializer = m.encodeFunctionCall(AaveFundingPool, "initialize", [
    admin,
    m.getParameter("Name"),
    m.getParameter("Symbol"),
    EthereumTokens.wstETH.address,
    StETHPriceOracle,
  ]);
  const WstETHPoolProxy = m.contract(
    "TransparentUpgradeableProxy",
    [AaveFundingPool, ProxyAdmin, WstETHPoolInitializer],
    { id: "WstETHPoolProxy" }
  );
  const WstETHPool = m.contractAt("AaveFundingPool", WstETHPoolProxy, { id: "WstETHPool" });
  m.call(WstETHPool, "updateRebalanceRatios", [
    m.getParameter("RebalanceDebtRatio"),
    m.getParameter("RebalanceBonusRatio"),
  ]);
  m.call(WstETHPool, "updateLiquidateRatios", [
    m.getParameter("LiquidateDebtRatio"),
    m.getParameter("LiquidateBonusRatio"),
  ]);

  // register to PoolManagerProxy
  m.call(PoolManagerProxy, "registerPool", [
    WstETHPoolProxy,
    SfxUSDRewarder,
    m.getParameter("CollateralCapacity"),
    m.getParameter("DebtCapacity"),
  ]);

  // register wstETH rate provider
  m.call(PoolManagerProxy, "updateRateProvider", [EthereumTokens.wstETH.address, m.getParameter("RateProvider")]);

  return {
    WstETHPool,
    StETHPriceOracle,
  };
});
