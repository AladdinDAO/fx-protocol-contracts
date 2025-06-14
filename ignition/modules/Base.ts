import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers, id, ZeroAddress } from "ethers";

import {
  ChainlinkPriceFeed,
  encodeChainlinkPriceFeed,
  BaseTokens,
  BaseSpotPriceEncodings,
  encodeSpotPriceSources,
} from "@/utils/index";

/* eslint-disable prettier/prettier */
// prettier-ignore
export default buildModule("Base", (m) => {
  const admin = m.getAccount(0);

  const FxProxyAdmin = m.contract("ProxyAdmin", [], { id: "FxProxyAdmin" });
  const CustomProxyAdmin = m.contract("ProxyAdmin", [], { id: "CustomProxyAdmin" });
  const EmptyContract = m.contract("EmptyContract", [])

  const AerodromeSpotPriceReader = m.contract("AerodromeSpotPriceReader", []);
  const SpotPriceOracle = m.contractAt("ISpotPriceOracleOwnable", m.getParameter("SpotPriceOracle"), {id: "SpotPriceOracle"});
  const SpotPriceOracleUpdateReaderCall = m.call(SpotPriceOracle, "updateReader", [12, AerodromeSpotPriceReader]);

  // deploy bFXNProxy, TokenMinterProxy, TokenScheduleProxy, xbFXNProxy, abFXNProxy, xbFXNGaugeProxy
  const bFXNProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], {id: "bFXNProxy"});
  const TokenMinterProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], {id: "TokenMinterProxy"});
  const TokenScheduleProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], {id: "TokenScheduleProxy"});
  const xbFXNProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], {id: "xbFXNProxy"});
  const abFXNProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], {id: "abFXNProxy"});
  const xbFXNGaugeProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], {id: "xbFXNGaugeProxy"});

  // deploy bFXN implementation and initialize bFXN proxy
  const bFXNImplementation = m.contract("bFXN", [TokenMinterProxy], { id: "bFXNImplementation" });
  const bFXNProxyUpgrade = m.call(CustomProxyAdmin, "upgrade", [bFXNProxy, bFXNImplementation], { id: "bFXN_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [bFXNProxy, FxProxyAdmin], { id: "bFXN_changeProxyAdmin", after: [bFXNProxyUpgrade] });
  const bFXN = m.contractAt("bFXN", bFXNProxy, { id: "bFXN" });
  const bFXNInitialize = m.call(bFXN, "initialize", ["bFXN", "bFXN"], { after: [bFXNProxyUpgrade] });

  // deploy TokenMinter implementation and initialize TokenMinter proxy
  const TokenMinterImplementation = m.contract("TokenMinter", [bFXNProxy], { id: "TokenMinterImplementation" });
  const TokenMinterProxyUpgrade = m.call(CustomProxyAdmin, "upgrade", [TokenMinterProxy, TokenMinterImplementation], { id: "TokenMinter_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [TokenMinterProxy, FxProxyAdmin], { id: "TokenMinter_changeProxyAdmin", after: [TokenMinterProxyUpgrade] });
  const TokenMinter = m.contractAt("TokenMinter", TokenMinterProxy, { id: "TokenMinter" });
  const TokenMinterInitialize = m.call(TokenMinter, "initialize", [ethers.parseEther("122000000"), ethers.parseEther("0.247336377473363774"), 1111111111111111111n], { after: [TokenMinterProxyUpgrade] });

  // deploy TokenSchedule implementation and initialize TokenSchedule proxy
  const TokenScheduleImplementation = m.contract("TokenSchedule", [TokenMinterProxy], { id: "TokenScheduleImplementation", after: [TokenMinterInitialize] });
  const TokenScheduleProxyUpgrade = m.call(CustomProxyAdmin, "upgrade", [TokenScheduleProxy, TokenScheduleImplementation], { id: "TokenSchedule_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [TokenScheduleProxy, FxProxyAdmin], { id: "TokenSchedule_changeProxyAdmin", after: [TokenScheduleProxyUpgrade] });
  const TokenSchedule = m.contractAt("TokenSchedule", TokenScheduleProxy, { id: "TokenSchedule" });
  const TokenScheduleInitialize = m.call(TokenSchedule, "initialize", [], { after: [TokenScheduleProxyUpgrade] });

  // deploy xbFXN implementation and initialize xbFXN proxy
  const xbFXNImplementation = m.contract("xbFXN", [bFXNProxy, xbFXNGaugeProxy], { id: "xbFXNImplementation" });
  const xbFXNProxyUpgrade = m.call(CustomProxyAdmin, "upgrade", [xbFXNProxy, xbFXNImplementation], { id: "xbFXN_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [xbFXNProxy, FxProxyAdmin], { id: "xbFXN_changeProxyAdmin", after: [xbFXNProxyUpgrade] });
  const xbFXN = m.contractAt("xbFXN", xbFXNProxy, { id: "xbFXN" });
  const xbFXNInitialize = m.call(xbFXN, "initialize", ["xbFXN", "xbFXN"], { after: [xbFXNProxyUpgrade] });

  // deploy xbFXNGauge implementation and initialize xbFXNGauge proxy
  const GaugeImplementation = m.contract("Gauge", [bFXNProxy, xbFXNProxy], {id: "GaugeImplementation"});
  const xbFXNGaugeProxyUpgrade = m.call(CustomProxyAdmin, "upgrade", [xbFXNGaugeProxy, GaugeImplementation], { id: "xbFXNGauge_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [xbFXNGaugeProxy, FxProxyAdmin], { id: "xbFXNGauge_changeProxyAdmin", after: [xbFXNGaugeProxyUpgrade] });
  const xbFXNGauge = m.contractAt("Gauge", xbFXNGaugeProxy, { id: "xbFXNGauge" });
  const xbFXNGaugeInitialize = m.call(xbFXNGauge, "initialize", [xbFXNProxy], { after: [xbFXNGaugeProxyUpgrade] });

  // deploy abFXN implementation and initialize abFXN proxy
  const abFXNImplementation = m.contract("abFXN", [xbFXNGaugeProxy], { id: "abFXNImplementation", after: [xbFXNGaugeInitialize] });
  const abFXNProxyUpgrade = m.call(CustomProxyAdmin, "upgrade", [abFXNProxy, abFXNImplementation], { id: "abFXN_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [abFXNProxy, FxProxyAdmin], { id: "abFXN_changeProxyAdmin", after: [abFXNProxyUpgrade] });
  const abFXN = m.contractAt("abFXN", abFXNProxy, { id: "abFXN" });
  const abFXNInitialize = m.call(abFXN, "initialize", ["abFXN", "abFXN"], { after: [abFXNProxyUpgrade] });

  // Governance Token related configuration
  m.call(TokenMinter, "grantRole", [id("MINTER_ROLE"), TokenSchedule], {after: [TokenMinterInitialize]});
  m.call(TokenSchedule, "grantRole", [id("DISTRIBUTOR_ROLE"), admin], {after: [TokenScheduleInitialize]});
  m.call(xbFXN, "grantRole", [id("DISTRIBUTOR_ROLE"), admin], {after: [xbFXNInitialize]});
  const xbFXNGaugeGrantRoleCall = m.call(xbFXNGauge, "grantRole", [id("REWARD_MANAGER_ROLE"), admin], {after: [xbFXNGaugeInitialize]});
  m.call(xbFXNGauge, "registerRewardToken", [xbFXNProxy, xbFXNProxy], { after: [xbFXNGaugeGrantRoleCall] });

  // deploy OpenReservePool, CloseReservePool, MiscReservePool
  const Treasury = m.getParameter("Treasury");
  const OpenRevenuePool = m.contract("RevenuePool", [Treasury, Treasury, admin], {id: "OpenReservePool"});
  const CloseRevenuePool = m.contract("RevenuePool", [Treasury, Treasury, admin], {id: "CloseRevenuePool"});
  const MiscRevenuePool = m.contract("RevenuePool", [Treasury, Treasury, admin], {id: "MiscRevenuePool"});

  // deploy PoolManagerProxy, BasePegKeeperProxy, FxUSDBasePoolProxy, FxUSDProxy, FxUSDBasePoolGaugeProxy
  const PoolManagerProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], { id: "PoolManagerProxy" });
  const BasePegKeeperProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], { id: "BasePegKeeperProxy" });
  const FxUSDBasePoolProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], { id: "FxUSDBasePoolProxy" });
  const FxUSDProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], { id: "FxUSDProxy" });
  const FxUSDBasePoolGaugeProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], { id: "FxUSDBasePoolGaugeProxy" });

  // deploy ReservePool
  const ReservePool = m.contract("ReservePool", [admin, PoolManagerProxy]);

  // deploy PoolManager implementation and initialize PoolManager proxy
  const PoolManagerImplementation = m.contract("PoolManager", [FxUSDProxy, FxUSDBasePoolProxy, BasePegKeeperProxy], { id: "PoolManagerImplementation" });
  const PoolManagerUpgrade = m.call(CustomProxyAdmin, "upgrade", [PoolManagerProxy, PoolManagerImplementation], { id: "PoolManager_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [PoolManagerProxy, FxProxyAdmin], { id: "PoolManager_changeProxyAdmin", after: [PoolManagerUpgrade] });
  const PoolManager = m.contractAt("PoolManager", PoolManagerProxy, { id: "PoolManager" });
  const PoolManagerInitialize = m.call(PoolManager, "initialize", [
    admin,
    0n,
    m.getParameter("HarvesterRatio"),
    m.getParameter("FlashLoanFeeRatio"),
    Treasury,
    OpenRevenuePool,
    ReservePool,
  ], { after: [PoolManagerUpgrade] });

  // deploy FxUSDBasePool implementation and initialize FxUSDBasePool proxy
  const USDC_USD_PRICE_FEED = encodeChainlinkPriceFeed(
    ChainlinkPriceFeed.base["USDC-USD"].feed,
    ChainlinkPriceFeed.base["USDC-USD"].scale,
    ChainlinkPriceFeed.base["USDC-USD"].heartbeat
  );
  const FxUSDBasePoolImplementation = m.contract("FxUSDBasePool", [PoolManagerProxy, BasePegKeeperProxy, FxUSDProxy, BaseTokens.USDC.address, USDC_USD_PRICE_FEED], { id: "FxUSDBasePoolImplementation" });
  const FxUSDBasePoolUpgrade = m.call(CustomProxyAdmin, "upgrade", [FxUSDBasePoolProxy, FxUSDBasePoolImplementation], { id: "FxUSDBasePool_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [FxUSDBasePoolProxy, FxProxyAdmin], { id: "FxUSDBasePool_changeProxyAdmin", after: [FxUSDBasePoolUpgrade] });
  const FxUSDBasePool = m.contractAt("FxUSDBasePool", FxUSDBasePoolProxy, { id: "FxUSDBasePool" });
  const FxUSDBasePoolInitialize = m.call(FxUSDBasePool, "initialize", [admin, "f(x) Stability Pool", "fxSP", m.getParameter("StableDepegPrice"), m.getParameter("RedeemCoolDownPeriod")], { after: [FxUSDBasePoolUpgrade] });

  // deploy BasePegKeeper implementation and initialize BasePegKeeper proxy
  const BasePegKeeperImplementation = m.contract("BasePegKeeper", [FxUSDBasePoolProxy], { id: "BasePegKeeperImplementation", after: [FxUSDBasePoolInitialize] });
  const BasePegKeeperUpgrade = m.call(CustomProxyAdmin, "upgrade", [BasePegKeeperProxy, BasePegKeeperImplementation], { id: "BasePegKeeper_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [BasePegKeeperProxy, FxProxyAdmin], { id: "BasePegKeeper_changeProxyAdmin", after: [BasePegKeeperUpgrade] });
  const BasePegKeeper = m.contractAt("BasePegKeeper", BasePegKeeperProxy, { id: "BasePegKeeper" });
  const BasePegKeeperInitialize = m.call(BasePegKeeper, "initialize", [admin, ZeroAddress, ZeroAddress], { after: [BasePegKeeperUpgrade] });

  // deploy FxUSD implementation and initialize FxUSD proxy
  const FxUSDImplementation = m.contract("L2FxUSD", [PoolManagerProxy, BaseTokens.USDC.address, BasePegKeeperProxy], { id: "FxUSDImplementation" });
  const FxUSDUpgrade = m.call(CustomProxyAdmin, "upgrade", [FxUSDProxy, FxUSDImplementation], { id: "FxUSD_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [FxUSDProxy, FxProxyAdmin], { id: "FxUSD_changeProxyAdmin", after: [FxUSDUpgrade] });
  const FxUSD = m.contractAt("L2FxUSD", FxUSDProxy, { id: "FxUSD" });
  const FxUSDInitialize = m.call(FxUSD, "initialize", ["f(x) USD", "fxUSD"], { after: [FxUSDUpgrade] });

  // initialize FxUSDBasePoolGauge proxy
  const FxUSDBasePoolGaugeProxyUpgrade = m.call(CustomProxyAdmin, "upgrade", [FxUSDBasePoolGaugeProxy, GaugeImplementation], { id: "FxUSDBasePoolGauge_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [FxUSDBasePoolGaugeProxy, FxProxyAdmin], { id: "FxUSDBasePoolGauge_changeProxyAdmin", after: [FxUSDBasePoolGaugeProxyUpgrade] });
  const FxUSDBasePoolGauge = m.contractAt("Gauge", FxUSDBasePoolGaugeProxy, { id: "FxUSDBasePoolGauge" });
  const FxUSDBasePoolGaugeInitialize = m.call(FxUSDBasePoolGauge, "initialize", [FxUSDBasePoolProxy], { after: [FxUSDBasePoolGaugeProxyUpgrade] });

  // deploy GaugeRewarder
  const GaugeRewarder = m.contract("GaugeRewarder", [FxUSDBasePoolGaugeProxy]);

  // PoolManager related configuration
  m.call(PoolManager, "updateExpenseRatio", [m.getParameter("RewardsExpenseRatio"), m.getParameter("FundingExpenseRatio"), m.getParameter("LiquidationExpenseRatio")], { after: [PoolManagerInitialize] });
  m.call(PoolManager, "updateRedeemFeeRatio", [m.getParameter("RedeemFeeRatio")], { after: [PoolManagerInitialize] });
  m.call(PoolManager, "updateMiscRevenuePool", [MiscRevenuePool], { after: [PoolManagerInitialize] });
  m.call(PoolManager, "updateCloseRevenuePool", [CloseRevenuePool], { after: [PoolManagerInitialize] });

  const FxUSDBasePoolGaugeGrantRoleCall = m.call(FxUSDBasePoolGauge, "grantRole", [id("REWARD_MANAGER_ROLE"), admin], {after: [FxUSDBasePoolGaugeInitialize]});
  m.call(FxUSDBasePoolGauge, "registerRewardToken", [BaseTokens.WETH.address, GaugeRewarder], {
    id: "FxUSDBasePoolGauge_registerRewardToken_WETH",
    after: [FxUSDBasePoolGaugeGrantRoleCall],
  });
  m.call(FxUSDBasePoolGauge, "registerRewardToken", [bFXNProxy, TokenSchedule], {
    id: "FxUSDBasePoolGauge_registerRewardToken_bFXN",
    after: [FxUSDBasePoolGaugeGrantRoleCall],
  });
  m.call(TokenSchedule, "updateGaugeWeight", [FxUSDBasePoolGauge, ethers.parseEther("1")], {id: "TokenSchedule_updateGaugeWeight_FxUSDBasePoolGauge", after: [TokenScheduleInitialize]});

  const AaveFundingPoolImplementation = m.contract(
    "AaveFundingPool",
    [PoolManagerProxy, m.getParameter("LendingPool"), m.getParameter("BaseAsset")],
    { id: "AaveFundingPoolImplementation", after: [PoolManagerInitialize] }
  );

  // deploy and configure WETH pool
  const ETH_USD_PRICE_FEED = encodeChainlinkPriceFeed(
    ChainlinkPriceFeed.base["ETH-USD"].feed,
    ChainlinkPriceFeed.base["ETH-USD"].scale,
    ChainlinkPriceFeed.base["ETH-USD"].heartbeat
  );
  const ETHPriceOracle = m.contract("ETHPriceOracle", [SpotPriceOracle, ETH_USD_PRICE_FEED]);
  const WETHPoolInitializer = m.encodeFunctionCall(AaveFundingPoolImplementation, "initialize", [
    admin,
    m.getParameter("WETHPool_Name"),
    m.getParameter("WETHPool_Symbol"),
    BaseTokens.WETH.address,
    ETHPriceOracle,
  ], {id: "WETHPoolInitializer"});
  const WETHPoolProxy = m.contract("TransparentUpgradeableProxy", [AaveFundingPoolImplementation, FxProxyAdmin, WETHPoolInitializer], { id: "WETHPoolProxy" });
  const WETHPool = m.contractAt("AaveFundingPool", WETHPoolProxy, { id: "WETHPool" });
  m.call(ETHPriceOracle, "updateOnchainSpotEncodings", [BaseSpotPriceEncodings["WETH/USDC"]], {after: [SpotPriceOracleUpdateReaderCall]});
  m.call(WETHPool, "updateDebtRatioRange", [m.getParameter("WETHPool_DebtRatioLower"), m.getParameter("WETHPool_DebtRatioUpper")]);
  m.call(WETHPool, "updateRebalanceRatios", [m.getParameter("WETHPool_RebalanceDebtRatio"), m.getParameter("WETHPool_RebalanceBonusRatio")]);
  m.call(WETHPool, "updateLiquidateRatios", [m.getParameter("WETHPool_LiquidateDebtRatio"), m.getParameter("WETHPool_LiquidateBonusRatio")]);
  m.call(WETHPool, "updateOpenRatio", [m.getParameter("WETHPool_OpenRatio"), m.getParameter("WETHPool_OpenRatioStep")]);
  m.call(WETHPool, "updateCloseFeeRatio", [m.getParameter("WETHPool_CloseFeeRatio")]);
  m.call(WETHPool, "updateFundingRatio", [m.getParameter("WETHPool_FundingRatio")]);
  m.call(PoolManager, "registerPool", [WETHPoolProxy, GaugeRewarder, m.getParameter("WETHPool_CollateralCapacity"), m.getParameter("WETHPool_DebtCapacity")], {id: "PoolManager_registerPool_WETH", after: [PoolManagerInitialize]});
  m.call(PoolManager, "updateRateProvider", [BaseTokens.WETH.address, ZeroAddress], {id: "PoolManager_updateRateProvider_WETH", after: [PoolManagerInitialize]});

  // deploy and configure cbBTC pool
  const BTC_USD_PRICE_FEED = encodeChainlinkPriceFeed(
    ChainlinkPriceFeed.base["BTC-USD"].feed,
    ChainlinkPriceFeed.base["BTC-USD"].scale,
    ChainlinkPriceFeed.base["BTC-USD"].heartbeat
  );
  const BaseCbBTCPriceOracle = m.contract("BaseCbBTCPriceOracle", [SpotPriceOracle, BTC_USD_PRICE_FEED]);
  const cbBTCInitializer = m.encodeFunctionCall(AaveFundingPoolImplementation, "initialize", [
    admin,
    m.getParameter("cbBTCPool_Name"),
    m.getParameter("cbBTCPool_Symbol"),
    BaseTokens.cbBTC.address,
    BaseCbBTCPriceOracle,
  ], {id: "cbBTCInitializer"});
  const cbBTCPoolProxy = m.contract("TransparentUpgradeableProxy", [AaveFundingPoolImplementation, FxProxyAdmin, cbBTCInitializer], { id: "cbBTCPoolProxy" });
  const cbBTCPool = m.contractAt("AaveFundingPool", cbBTCPoolProxy, { id: "cbBTCPool" });
  m.call(BaseCbBTCPriceOracle, "updateOnchainSpotEncodings", [BaseSpotPriceEncodings["cbBTC/USDC"]], {after: [SpotPriceOracleUpdateReaderCall]});
  m.call(cbBTCPool, "updateDebtRatioRange", [m.getParameter("cbBTCPool_DebtRatioLower"), m.getParameter("cbBTCPool_DebtRatioUpper")]);
  m.call(cbBTCPool, "updateRebalanceRatios", [m.getParameter("cbBTCPool_RebalanceDebtRatio"), m.getParameter("cbBTCPool_RebalanceBonusRatio")]);
  m.call(cbBTCPool, "updateLiquidateRatios", [m.getParameter("cbBTCPool_LiquidateDebtRatio"), m.getParameter("cbBTCPool_LiquidateBonusRatio")]);
  m.call(cbBTCPool, "updateOpenRatio", [m.getParameter("cbBTCPool_OpenRatio"), m.getParameter("cbBTCPool_OpenRatioStep")]);
  m.call(cbBTCPool, "updateCloseFeeRatio", [m.getParameter("cbBTCPool_CloseFeeRatio")]);
  m.call(cbBTCPool, "updateFundingRatio", [m.getParameter("cbBTCPool_FundingRatio")]);
  m.call(PoolManager, "registerPool", [cbBTCPoolProxy, GaugeRewarder, m.getParameter("cbBTCPool_CollateralCapacity"), m.getParameter("cbBTCPool_DebtCapacity")], {id: "PoolManager_registerPool_cbBTC", after: [PoolManagerInitialize]});
  m.call(PoolManager, "updateRateProvider", [BaseTokens.cbBTC.address, ZeroAddress], {id: "PoolManager_updateRateProvider_cbBTC", after: [PoolManagerInitialize]});

  // deploy and configure wstETH pool
  const wstETH_ETH_PRICE_FEED = encodeChainlinkPriceFeed(
    ChainlinkPriceFeed.base["wstETH-ETH"].feed,
    ChainlinkPriceFeed.base["wstETH-ETH"].scale,
    ChainlinkPriceFeed.base["wstETH-ETH"].heartbeat
  );
  const wstETH_stETH_PRICE_FEED = encodeChainlinkPriceFeed(
    ChainlinkPriceFeed.base["wstETH-stETH"].feed,
    ChainlinkPriceFeed.base["wstETH-stETH"].scale,
    ChainlinkPriceFeed.base["wstETH-stETH"].heartbeat
  );
  const BaseStETHPriceOracle = m.contract("BaseStETHPriceOracle", [SpotPriceOracle, ETH_USD_PRICE_FEED, wstETH_ETH_PRICE_FEED, wstETH_stETH_PRICE_FEED]);
  const wstETHRateProvider = m.contract("ChainlinkRateProvider", [wstETH_stETH_PRICE_FEED], {id: "WstETHRateProvider"});
  const wstETHPoolInitializer = m.encodeFunctionCall(AaveFundingPoolImplementation, "initialize", [
    admin,
    m.getParameter("wstETHPool_Name"),
    m.getParameter("wstETHPool_Symbol"),
    BaseTokens.wstETH.address,
    BaseStETHPriceOracle,
  ], {id: "wstETHPoolInitializer"});
  const wstETHPoolProxy = m.contract("TransparentUpgradeableProxy", [AaveFundingPoolImplementation, FxProxyAdmin, wstETHPoolInitializer], { id: "wstETHPoolProxy" });
  const wstETHPool = m.contractAt("AaveFundingPool", wstETHPoolProxy, { id: "wstETHPool" });
  m.call(BaseStETHPriceOracle, "updateOnchainSpotEncodings", [BaseSpotPriceEncodings["WETH/USDC"], 0], {id: "BaseStETHPriceOracle_updateOnchainSpotEncodings_ETH_USD", after: [SpotPriceOracleUpdateReaderCall]});
  m.call(BaseStETHPriceOracle, "updateOnchainSpotEncodings", [BaseSpotPriceEncodings["wstETH/ETH"], 1], {id: "BaseStETHPriceOracle_updateOnchainSpotEncodings_wstETH_ETH", after: [SpotPriceOracleUpdateReaderCall]});
  m.call(BaseStETHPriceOracle, "updateOnchainSpotEncodings", [encodeSpotPriceSources([]), 2], {id: "BaseStETHPriceOracle_updateOnchainSpotEncodings_wstETH_USD", after: [SpotPriceOracleUpdateReaderCall]});
  m.call(wstETHPool, "updateDebtRatioRange", [m.getParameter("wstETHPool_DebtRatioLower"), m.getParameter("wstETHPool_DebtRatioUpper")]);
  m.call(wstETHPool, "updateRebalanceRatios", [m.getParameter("wstETHPool_RebalanceDebtRatio"), m.getParameter("wstETHPool_RebalanceBonusRatio")]);
  m.call(wstETHPool, "updateLiquidateRatios", [m.getParameter("wstETHPool_LiquidateDebtRatio"), m.getParameter("wstETHPool_LiquidateBonusRatio")]);
  m.call(wstETHPool, "updateOpenRatio", [m.getParameter("wstETHPool_OpenRatio"), m.getParameter("wstETHPool_OpenRatioStep")]);
  m.call(wstETHPool, "updateCloseFeeRatio", [m.getParameter("wstETHPool_CloseFeeRatio")]);
  m.call(wstETHPool, "updateFundingRatio", [m.getParameter("wstETHPool_FundingRatio")]);
  m.call(PoolManager, "registerPool", [wstETHPoolProxy, GaugeRewarder, m.getParameter("wstETHPool_CollateralCapacity"), m.getParameter("wstETHPool_DebtCapacity")], {id: "PoolManager_registerPool_wstETH", after: [PoolManagerInitialize]});
  m.call(PoolManager, "updateRateProvider", [BaseTokens.wstETH.address, wstETHRateProvider], {id: "PoolManager_updateRateProvider_wstETH", after: [PoolManagerInitialize]});

  return {
    bFXN,
    TokenSchedule,
    TokenMinter,
    xbFXN,
    xbFXNGauge,
    abFXN,

    GaugeRewarder,
    ReservePool,
    OpenRevenuePool,
    CloseRevenuePool,
    MiscRevenuePool,

    PoolManager,
    BasePegKeeper,
    FxUSD,
    FxUSDBasePool,
    FxUSDBasePoolGauge,

    WETHPool,
    ETHPriceOracle,
    cbBTCPool,
    BaseCbBTCPriceOracle,
    wstETHPool,
    BaseStETHPriceOracle,
    wstETHRateProvider,
  };
});
/* eslint-enable prettier/prettier */
