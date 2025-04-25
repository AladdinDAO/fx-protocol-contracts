import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers, id, ZeroAddress } from "ethers";

import {
  ChainlinkPriceFeed,
  encodeChainlinkPriceFeed,
  BSCTokens,
  BSCSpotPriceEncodings,
} from "@/utils/index";

/* eslint-disable prettier/prettier */
// prettier-ignore
export default buildModule("BSC", (m) => {
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

  // deploy PoolManagerProxy, BSCPegKeeperProxy, FxUSDBSCPoolProxy, FxUSDProxy, FxUSDBSCPoolGaugeProxy
  const PoolManagerProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], { id: "PoolManagerProxy" });
  const BSCPegKeeperProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], { id: "BSCPegKeeperProxy" });
  const FxUSDBSCPoolProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], { id: "FxUSDBSCPoolProxy" });
  const FxUSDProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], { id: "FxUSDProxy" });
  const FxUSDBSCPoolGaugeProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], { id: "FxUSDBSCPoolGaugeProxy" });

  // deploy ReservePool
  const ReservePool = m.contract("ReservePool", [admin, PoolManagerProxy]);

  // deploy PoolManager implementation and initialize PoolManager proxy
  const PoolManagerImplementation = m.contract("PoolManager", [FxUSDProxy, FxUSDBSCPoolProxy, BSCPegKeeperProxy], { id: "PoolManagerImplementation" });
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

  // deploy FxUSDBSCPool implementation and initialize FxUSDBSCPool proxy
  const USDC_USD_PRICE_FEED = encodeChainlinkPriceFeed(
    ChainlinkPriceFeed.bsc["USDT-USD"].feed,
    ChainlinkPriceFeed.bsc["USDT-USD"].scale,
    ChainlinkPriceFeed.bsc["USDT-USD"].heartbeat
  );
  const FxUSDBSCPoolImplementation = m.contract("FxUSDBasePool", [PoolManagerProxy, BSCPegKeeperProxy, FxUSDProxy, BSCTokens.USDT.address, USDC_USD_PRICE_FEED], { id: "FxUSDBSCPoolImplementation" });
  const FxUSDBSCPoolUpgrade = m.call(CustomProxyAdmin, "upgrade", [FxUSDBSCPoolProxy, FxUSDBSCPoolImplementation], { id: "FxUSDBSCPool_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [FxUSDBSCPoolProxy, FxProxyAdmin], { id: "FxUSDBSCPool_changeProxyAdmin", after: [FxUSDBSCPoolUpgrade] });
  const FxUSDBSCPool = m.contractAt("FxUSDBasePool", FxUSDBSCPoolProxy, { id: "FxUSDBSCPool" });
  const FxUSDBSCPoolInitialize = m.call(FxUSDBSCPool, "initialize", [admin, "f(x) Stability Pool", "fxSP", m.getParameter("StableDepegPrice"), m.getParameter("RedeemCoolDownPeriod")], { after: [FxUSDBSCPoolUpgrade] });

  // deploy BSCPegKeeper implementation and initialize BSCPegKeeper proxy
  const BSCPegKeeperImplementation = m.contract("BasePegKeeper", [FxUSDBSCPoolProxy], { id: "BSCPegKeeperImplementation", after: [FxUSDBSCPoolInitialize] });
  const BSCPegKeeperUpgrade = m.call(CustomProxyAdmin, "upgrade", [BSCPegKeeperProxy, BSCPegKeeperImplementation], { id: "BSCPegKeeper_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [BSCPegKeeperProxy, FxProxyAdmin], { id: "BSCPegKeeper_changeProxyAdmin", after: [BSCPegKeeperUpgrade] });
  const BSCPegKeeper = m.contractAt("BasePegKeeper", BSCPegKeeperProxy, { id: "BSCPegKeeper" });
  const BSCPegKeeperInitialize = m.call(BSCPegKeeper, "initialize", [admin, ZeroAddress, ZeroAddress], { after: [BSCPegKeeperUpgrade] });

  // deploy FxUSD implementation and initialize FxUSD proxy
  const FxUSDImplementation = m.contract("L2FxUSD", [PoolManagerProxy, BSCTokens.USDT.address, BSCPegKeeperProxy], { id: "FxUSDImplementation" });
  const FxUSDUpgrade = m.call(CustomProxyAdmin, "upgrade", [FxUSDProxy, FxUSDImplementation], { id: "FxUSD_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [FxUSDProxy, FxProxyAdmin], { id: "FxUSD_changeProxyAdmin", after: [FxUSDUpgrade] });
  const FxUSD = m.contractAt("L2FxUSD", FxUSDProxy, { id: "FxUSD" });
  const FxUSDInitialize = m.call(FxUSD, "initialize", ["f(x) USD", "fxUSD"], { after: [FxUSDUpgrade] });

  // initialize FxUSDBSCPoolGauge proxy
  const FxUSDBSCPoolGaugeProxyUpgrade = m.call(CustomProxyAdmin, "upgrade", [FxUSDBSCPoolGaugeProxy, GaugeImplementation], { id: "FxUSDBSCPoolGauge_upgrade" });
  m.call(CustomProxyAdmin, "changeProxyAdmin", [FxUSDBSCPoolGaugeProxy, FxProxyAdmin], { id: "FxUSDBSCPoolGauge_changeProxyAdmin", after: [FxUSDBSCPoolGaugeProxyUpgrade] });
  const FxUSDBSCPoolGauge = m.contractAt("Gauge", FxUSDBSCPoolGaugeProxy, { id: "FxUSDBSCPoolGauge" });
  const FxUSDBSCPoolGaugeInitialize = m.call(FxUSDBSCPoolGauge, "initialize", [FxUSDBSCPoolProxy], { after: [FxUSDBSCPoolGaugeProxyUpgrade] });

  // deploy GaugeRewarder
  const GaugeRewarder = m.contract("GaugeRewarder", [FxUSDBSCPoolGaugeProxy]);

  // PoolManager related configuration
  m.call(PoolManager, "updateExpenseRatio", [m.getParameter("RewardsExpenseRatio"), m.getParameter("FundingExpenseRatio"), m.getParameter("LiquidationExpenseRatio")], { after: [PoolManagerInitialize] });
  m.call(PoolManager, "updateRedeemFeeRatio", [m.getParameter("RedeemFeeRatio")], { after: [PoolManagerInitialize] });
  m.call(PoolManager, "updateMiscRevenuePool", [MiscRevenuePool], { after: [PoolManagerInitialize] });
  m.call(PoolManager, "updateCloseRevenuePool", [CloseRevenuePool], { after: [PoolManagerInitialize] });

  const FxUSDBSCPoolGaugeGrantRoleCall = m.call(FxUSDBSCPoolGauge, "grantRole", [id("REWARD_MANAGER_ROLE"), admin], {after: [FxUSDBSCPoolGaugeInitialize]});
  m.call(FxUSDBSCPoolGauge, "registerRewardToken", [BSCTokens.WBNB.address, GaugeRewarder], {
    id: "FxUSDBSCPoolGauge_registerRewardToken_WBNB",
    after: [FxUSDBSCPoolGaugeGrantRoleCall],
  });
  m.call(FxUSDBSCPoolGauge, "registerRewardToken", [bFXNProxy, TokenSchedule], {
    id: "FxUSDBSCPoolGauge_registerRewardToken_bFXN",
    after: [FxUSDBSCPoolGaugeGrantRoleCall],
  });
  m.call(TokenSchedule, "updateGaugeWeight", [FxUSDBSCPoolGauge, ethers.parseEther("1")], {id: "TokenSchedule_updateGaugeWeight_FxUSDBSCPoolGauge", after: [TokenScheduleInitialize]});

  const AaveFundingPoolImplementation = m.contract(
    "AaveFundingPool",
    [PoolManagerProxy, m.getParameter("LendingPool"), m.getParameter("BaseAsset")],
    { id: "AaveFundingPoolImplementation", after: [PoolManagerInitialize] }
  );

  // deploy and configure WBNB pool
  const BNB_USD_PRICE_FEED = encodeChainlinkPriceFeed( //bnb-usd
    ChainlinkPriceFeed.bsc["BNB-USD"].feed,
    ChainlinkPriceFeed.bsc["BNB-USD"].scale,
    ChainlinkPriceFeed.bsc["BNB-USD"].heartbeat
  );
  const BNBPriceOracle = m.contract("ETHPriceOracle", [SpotPriceOracle, BNB_USD_PRICE_FEED]);
  const WBNBPoolInitializer = m.encodeFunctionCall(AaveFundingPoolImplementation, "initialize", [
    admin,
    m.getParameter("WBNBPool_Name"),
    m.getParameter("WBNBPool_Symbol"),
    BSCTokens.WBNB.address,
    BNBPriceOracle,
  ], {id: "WBNBPoolInitializer"});
  const WBNBPoolProxy = m.contract("TransparentUpgradeableProxy", [AaveFundingPoolImplementation, FxProxyAdmin, WBNBPoolInitializer], { id: "WBNBPoolProxy" });
  const WBNBPool = m.contractAt("AaveFundingPool", WBNBPoolProxy, { id: "WBNBPool" });
  m.call(BNBPriceOracle, "updateOnchainSpotEncodings", [BSCSpotPriceEncodings["WBNB/USDT"]], {after: [SpotPriceOracleUpdateReaderCall]});
  m.call(WBNBPool, "updateDebtRatioRange", [m.getParameter("WBNBPool_DebtRatioLower"), m.getParameter("WBNBPool_DebtRatioUpper")]);
  m.call(WBNBPool, "updateRebalanceRatios", [m.getParameter("WBNBPool_RebalanceDebtRatio"), m.getParameter("WBNBPool_RebalanceBonusRatio")]);
  m.call(WBNBPool, "updateLiquidateRatios", [m.getParameter("WBNBPool_LiquidateDebtRatio"), m.getParameter("WBNBPool_LiquidateBonusRatio")]);
  m.call(WBNBPool, "updateOpenRatio", [m.getParameter("WBNBPool_OpenRatio"), m.getParameter("WBNBPool_OpenRatioStep")]);
  m.call(WBNBPool, "updateCloseFeeRatio", [m.getParameter("WBNBPool_CloseFeeRatio")]);
  m.call(WBNBPool, "updateFundingRatio", [m.getParameter("WBNBPool_FundingRatio")]);
  m.call(PoolManager, "registerPool", [WBNBPoolProxy, GaugeRewarder, m.getParameter("WBNBPool_CollateralCapacity"), m.getParameter("WBNBPool_DebtCapacity")], {id: "PoolManager_registerPool_WBNB", after: [PoolManagerInitialize]});
  m.call(PoolManager, "updateRateProvider", [BSCTokens.WBNB.address, ZeroAddress], {id: "PoolManager_updateRateProvider_WBNB", after: [PoolManagerInitialize]});

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
    BSCPegKeeper,
    FxUSD,
    FxUSDBSCPool,
    FxUSDBSCPoolGauge,

    WBNBPool,
    BNBPriceOracle,
  };
});
/* eslint-enable prettier/prettier */