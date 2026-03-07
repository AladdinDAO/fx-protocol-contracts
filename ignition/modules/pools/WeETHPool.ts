import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { KatanaTokens } from "@/utils/tokens";

import FxProtocolModule from "../FxProtocol";
import PriceOracleModule from "../PriceOracle";
import ProxyAdminModule from "../ProxyAdmin";
import MorphoFundingPoolModule from "./MorphoFundingPool";
import { ethers, id, ZeroAddress } from "ethers";
import { encodeChainlinkPriceFeed } from "@/utils/codec";
import { ChainlinkPriceFeed } from "@/utils/oracle";

export default buildModule("WeETHPool", (m) => {
  const admin = m.getAccount(0);
  const { fx: ProxyAdmin } = m.useModule(ProxyAdminModule);
  const { MorphoFundingPoolImplementation } = m.useModule(MorphoFundingPoolModule);
  const { ETHPriceOracle } = m.useModule(PriceOracleModule);
  const { PoolManagerProxy, RevenuePool, PoolConfiguration, GaugeRewarder } = m.useModule(FxProtocolModule);

  // deploy weETHPool proxy
  const WeETHPoolInitializer = m.encodeFunctionCall(MorphoFundingPoolImplementation, "initialize", [
    admin,
    m.getParameter("Name"),
    m.getParameter("Symbol"),
    KatanaTokens.weETH.address,
    ETHPriceOracle,
  ]);
  const WeETHPoolProxy = m.contract(
    "TransparentUpgradeableProxy",
    [MorphoFundingPoolImplementation, ProxyAdmin, WeETHPoolInitializer],
    { id: "WeETHPoolProxy" },
  );
  const WeETHPool = m.contractAt("MorphoFundingPool", WeETHPoolProxy, { id: "WeETHPool" });
  m.call(WeETHPool, "updateDebtRatioRange", [m.getParameter("DebtRatioLower"), m.getParameter("DebtRatioUpper")]);
  m.call(WeETHPool, "updateRebalanceRatios", [
    m.getParameter("RebalanceDebtRatio"),
    m.getParameter("RebalanceBonusRatio"),
  ]);
  m.call(WeETHPool, "updateLiquidateRatios", [
    m.getParameter("LiquidateDebtRatio"),
    m.getParameter("LiquidateBonusRatio"),
  ]);
  // const grantRole = m.call(WeETHPool, "grantRole", [id("EMERGENCY_ROLE"), admin]);
  // m.call(WeETHPool, "updateBorrowAndRedeemStatus", [true, true], { after: [grantRole] });
  // m.call(WeETHPool, "updateOpenRatio", [m.getParameter("OpenRatio"), m.getParameter("OpenRatioStep")]);
  // m.call(WeETHPool, "updateCloseFeeRatio", [m.getParameter("CloseFeeRatio")]);
  // m.call(WeETHPool, "updateFundingRatio", [m.getParameter("FundingRatio")]);

  // register to PoolManagerProxy
  m.call(PoolManagerProxy, "registerPool", [
    WeETHPoolProxy,
    m.getParameter("CollateralCapacity"),
    m.getParameter("DebtCapacity"),
  ]);

  // rate provider
  const WeETHRateProvider = m.contract("WeETHRateProvider", [
    m.getParameter("SpotPriceOracle"),
    encodeChainlinkPriceFeed(
      ChainlinkPriceFeed.katana["weETH-ETH"].feed,
      ChainlinkPriceFeed.katana["weETH-ETH"].scale,
      ChainlinkPriceFeed.katana["weETH-ETH"].heartbeat,
    ),
  ]);

  // register wstETH rate provider
  m.call(PoolManagerProxy, "updateRateProvider", [KatanaTokens.weETH.address, WeETHRateProvider]);

  // add reward token, 70% to fxSave, 30% to treasury
  m.call(RevenuePool, "addRewardToken", [
    KatanaTokens.weETH.address,
    GaugeRewarder,
    0n,
    ethers.parseUnits("0.5", 9),
    ethers.parseUnits("0.5", 9),
  ]);

  m.call(
    PoolConfiguration,
    "updatePoolFeeRatio",
    [WeETHPool, ZeroAddress, 0n, 300000000000000000n, 0n, 5000000n, 2000000n],
    {
      id: "WstETHLongPoolDefaultFeeRatio",
    },
  );

  m.call(
    PoolConfiguration,
    "updateLongFundingRatioParameter",
    [WeETHPool, 1000000000000000000n, 10000000000000000000n, 950000000000000000n],
    {
      id: "WstETHLongPoolFundingRatioParameter",
    },
  );

  return {
    WeETHPool,
    ETHPriceOracle,
  };
});
