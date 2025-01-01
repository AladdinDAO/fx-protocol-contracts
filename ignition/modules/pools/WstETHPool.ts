import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { EthereumTokens } from "@/utils/tokens";

import FxProtocolModule from "../FxProtocol";
import PriceOracleModule from "../PriceOracle";
import ProxyAdminModule from "../ProxyAdmin";
import AaveFundingPoolModule from "./AaveFundingPool";
import { ethers } from "ethers";

export default buildModule("WstETHPool", (m) => {
  const admin = m.getAccount(0);
  const { fx: ProxyAdmin } = m.useModule(ProxyAdminModule);
  const { AaveFundingPoolImplementation } = m.useModule(AaveFundingPoolModule);
  const { StETHPriceOracle } = m.useModule(PriceOracleModule);
  const { PoolManagerProxy, GaugeRewarder, RevenuePool } = m.useModule(FxProtocolModule);

  // deploy WstETHPool proxy
  const WstETHPoolInitializer = m.encodeFunctionCall(AaveFundingPoolImplementation, "initialize", [
    admin,
    m.getParameter("Name"),
    m.getParameter("Symbol"),
    EthereumTokens.wstETH.address,
    StETHPriceOracle,
  ]);
  const WstETHPoolProxy = m.contract(
    "TransparentUpgradeableProxy",
    [AaveFundingPoolImplementation, ProxyAdmin, WstETHPoolInitializer],
    { id: "WstETHPoolProxy" }
  );
  const WstETHPool = m.contractAt("AaveFundingPool", WstETHPoolProxy, { id: "WstETHPool" });
  m.call(WstETHPool, "updateDebtRatioRange", [m.getParameter("DebtRatioLower"), m.getParameter("DebtRatioUpper")]);
  m.call(WstETHPool, "updateRebalanceRatios", [
    m.getParameter("RebalanceDebtRatio"),
    m.getParameter("RebalanceBonusRatio"),
  ]);
  m.call(WstETHPool, "updateLiquidateRatios", [
    m.getParameter("LiquidateDebtRatio"),
    m.getParameter("LiquidateBonusRatio"),
  ]);
  m.call(WstETHPool, "updateBorrowAndRedeemStatus", [true, true]);
  m.call(WstETHPool, "updateOpenRatio", [m.getParameter("OpenRatio"), m.getParameter("OpenRatioStep")]);
  m.call(WstETHPool, "updateCloseFeeRatio", [m.getParameter("CloseFeeRatio")]);
  m.call(WstETHPool, "updateFundingRatio", [m.getParameter("FundingRatio")]);

  // register to PoolManagerProxy
  m.call(PoolManagerProxy, "registerPool", [
    WstETHPoolProxy,
    GaugeRewarder,
    m.getParameter("CollateralCapacity"),
    m.getParameter("DebtCapacity"),
  ]);

  // register wstETH rate provider
  m.call(PoolManagerProxy, "updateRateProvider", [EthereumTokens.wstETH.address, m.getParameter("RateProvider")]);

  // add reward token, 70% to fxSave, 30% to treasury
  m.call(RevenuePool, "addRewardToken", [
    EthereumTokens.wstETH.address,
    GaugeRewarder,
    0n,
    ethers.parseUnits("0.3", 9),
    ethers.parseUnits("0.7", 9),
  ]);

  return {
    WstETHPool,
    StETHPriceOracle,
  };
});
