import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { EthereumTokens } from "@/utils/tokens";

import FxProtocolModule from "../FxProtocol";
import PriceOracleModule from "../PriceOracle";
import ProxyAdminModule from "../ProxyAdmin";
import AaveFundingPoolModule from "./AaveFundingPool";
import { ethers, ZeroAddress } from "ethers";

export default buildModule("WETHPool", (m) => {
  const admin = m.getAccount(0);
  const { fx: ProxyAdmin } = m.useModule(ProxyAdminModule);
  const { AaveFundingPoolImplementation } = m.useModule(AaveFundingPoolModule);
  const { ETHPriceOracle } = m.useModule(PriceOracleModule);
  const { PoolManagerProxy, GaugeRewarder, RevenuePool } = m.useModule(FxProtocolModule);

  // deploy WETHPool proxy
  const WETHPoolInitializer = m.encodeFunctionCall(AaveFundingPoolImplementation, "initialize", [
    admin,
    m.getParameter("Name"),
    m.getParameter("Symbol"),
    EthereumTokens.WETH.address,
    ETHPriceOracle,
  ]);
  const WETHPoolProxy = m.contract(
    "TransparentUpgradeableProxy",
    [AaveFundingPoolImplementation, ProxyAdmin, WETHPoolInitializer],
    { id: "WETHPoolProxy" }
  );
  const WETHPool = m.contractAt("AaveFundingPool", WETHPoolProxy, { id: "WETHPool" });
  m.call(WETHPool, "updateDebtRatioRange", [m.getParameter("DebtRatioLower"), m.getParameter("DebtRatioUpper")]);
  m.call(WETHPool, "updateRebalanceRatios", [
    m.getParameter("RebalanceDebtRatio"),
    m.getParameter("RebalanceBonusRatio"),
  ]);
  m.call(WETHPool, "updateLiquidateRatios", [
    m.getParameter("LiquidateDebtRatio"),
    m.getParameter("LiquidateBonusRatio"),
  ]);
  m.call(WETHPool, "updateBorrowAndRedeemStatus", [true, true]);
  m.call(WETHPool, "updateOpenRatio", [m.getParameter("OpenRatio"), m.getParameter("OpenRatioStep")]);
  m.call(WETHPool, "updateCloseFeeRatio", [m.getParameter("CloseFeeRatio")]);
  m.call(WETHPool, "updateFundingRatio", [m.getParameter("FundingRatio")]);

  // register to PoolManagerProxy
  m.call(PoolManagerProxy, "registerPool", [
    WETHPoolProxy,
    GaugeRewarder,
    m.getParameter("CollateralCapacity"),
    m.getParameter("DebtCapacity"),
  ]);

  // register WETH rate provider
  m.call(PoolManagerProxy, "updateRateProvider", [EthereumTokens.WETH.address, ZeroAddress]);

  // add reward token, 70% to fxSave, 30% to treasury
  m.call(RevenuePool, "addRewardToken", [
    EthereumTokens.WETH.address,
    GaugeRewarder,
    0n,
    ethers.parseUnits("0.3", 9),
    ethers.parseUnits("0.7", 9),
  ]);

  return {
    WETHPool,
    ETHPriceOracle,
  };
});
