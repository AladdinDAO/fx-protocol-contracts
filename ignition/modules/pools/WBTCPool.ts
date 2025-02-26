import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { EthereumTokens } from "@/utils/tokens";

import FxProtocolModule from "../FxProtocol";
import PriceOracleModule from "../PriceOracle";
import ProxyAdminModule from "../ProxyAdmin";
import AaveFundingPoolModule from "./AaveFundingPool";
import { ethers, ZeroAddress } from "ethers";
import { ChainlinkPriceFeed, encodeChainlinkPriceFeed, SpotPriceEncodings } from "@/utils/index";

export default buildModule("WBTCPool", (m) => {
  const admin = m.getAccount(0);
  // const { fx: ProxyAdmin } = m.useModule(ProxyAdminModule);
  // const { AaveFundingPoolImplementation } = m.useModule(AaveFundingPoolModule);
  // const { PoolManagerProxy, GaugeRewarder, RevenuePool } = m.useModule(FxProtocolModule);

  const AaveFundingPoolImplementation = m.contractAt(
    "AaveFundingPool",
    m.getParameter("AaveFundingPoolImplementation"),
    { id: "AaveFundingPoolImplementation" }
  );
  const ProxyAdmin = m.contractAt("ProxyAdmin", m.getParameter("ProxyAdmin"));

  // deploy WBTCPriceOracle
  const WBTCPriceOracle = m.contract("WBTCPriceOracle", [
    m.getParameter("SpotPriceOracle"),
    encodeChainlinkPriceFeed(
      ChainlinkPriceFeed.ethereum["BTC-USD"].feed,
      ChainlinkPriceFeed.ethereum["BTC-USD"].scale,
      ChainlinkPriceFeed.ethereum["BTC-USD"].heartbeat
    ),
    encodeChainlinkPriceFeed(
      ChainlinkPriceFeed.ethereum["WBTC-BTC"].feed,
      ChainlinkPriceFeed.ethereum["WBTC-BTC"].scale,
      ChainlinkPriceFeed.ethereum["WBTC-BTC"].heartbeat
    ),
  ]);
  m.call(WBTCPriceOracle, "updateOnchainSpotEncodings", [SpotPriceEncodings["WBTC/USDC"]]);

  // deploy WBTCPool proxy
  const WBTCPoolInitializer = m.encodeFunctionCall(AaveFundingPoolImplementation, "initialize", [
    admin,
    m.getParameter("Name"),
    m.getParameter("Symbol"),
    EthereumTokens.WBTC.address,
    WBTCPriceOracle,
  ]);
  const WBTCPoolProxy = m.contract(
    "TransparentUpgradeableProxy",
    [AaveFundingPoolImplementation, ProxyAdmin, WBTCPoolInitializer],
    { id: "WBTCPoolProxy" }
  );
  const WBTCPool = m.contractAt("AaveFundingPool", WBTCPoolProxy, { id: "WBTCPool" });
  m.call(WBTCPool, "updateDebtRatioRange", [m.getParameter("DebtRatioLower"), m.getParameter("DebtRatioUpper")]);
  m.call(WBTCPool, "updateRebalanceRatios", [
    m.getParameter("RebalanceDebtRatio"),
    m.getParameter("RebalanceBonusRatio"),
  ]);
  m.call(WBTCPool, "updateLiquidateRatios", [
    m.getParameter("LiquidateDebtRatio"),
    m.getParameter("LiquidateBonusRatio"),
  ]);
  m.call(WBTCPool, "updateBorrowAndRedeemStatus", [true, true]);
  m.call(WBTCPool, "updateOpenRatio", [m.getParameter("OpenRatio"), m.getParameter("OpenRatioStep")]);
  m.call(WBTCPool, "updateCloseFeeRatio", [m.getParameter("CloseFeeRatio")]);
  m.call(WBTCPool, "updateFundingRatio", [m.getParameter("FundingRatio")]);

  /*
  // register to PoolManagerProxy
  m.call(PoolManagerProxy, "registerPool", [
    WBTCPoolProxy,
    GaugeRewarder,
    m.getParameter("CollateralCapacity"),
    m.getParameter("DebtCapacity"),
  ]);

  // register WBTC rate provider
  m.call(PoolManagerProxy, "updateRateProvider", [EthereumTokens.WBTC.address, ZeroAddress]);

  // add reward token, 70% to fxSave, 30% to treasury
  m.call(RevenuePool, "addRewardToken", [
    EthereumTokens.WBTC.address,
    GaugeRewarder,
    0n,
    ethers.parseUnits("0.3", 9),
    ethers.parseUnits("0.7", 9),
  ]);
  */

  return {
    WBTCPool,
    WBTCPriceOracle,
  };
});
