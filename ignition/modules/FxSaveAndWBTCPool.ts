import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { id, Interface, ZeroAddress } from "ethers";

import {
  Addresses,
  ChainlinkPriceFeed,
  encodeChainlinkPriceFeed,
  EthereumTokens,
  SpotPriceEncodings,
} from "@/utils/index";

import EmptyContractModule from "./EmptyContract";
import ProxyAdminModule from "./ProxyAdmin";
import Upgrade20250318Module from "./upgrades/Upgrade.20250318";
import {
  FxUSDBasePoolV2Facet__factory,
  MorphoFlashLoanCallbackFacet__factory,
  PositionOperateFlashLoanFacetV2__factory,
  SavingFxUSDFacet__factory,
} from "@/types/index";

const getAllSignatures = (e: Interface): string[] => {
  const sigs: string[] = [];
  e.forEachFunction((func, _) => {
    sigs.push(func.selector);
  });
  return sigs;
};

export default buildModule("FxSaveAndWBTCPool", (m) => {
  const admin = m.getAccount(0);
  const { fx: FxProxyAdmin, custom: CustomProxyAdmin } = m.useModule(ProxyAdminModule);
  const {
    AaveFundingPoolImplementation,
    PoolManagerProxy,
    FxUSDBasePoolProxy,
    Router,
    FxUSDBasePoolV2Facet,
    PositionOperateFlashLoanFacetV2,
    MorphoFlashLoanCallbackFacet,
    GaugeRewarder,
  } = m.useModule(Upgrade20250318Module);
  const { EmptyContract } = m.useModule(EmptyContractModule);

  // deploy FxUSDBasePool Gauge V2
  const LiquidityGaugeImplementation = m.contractAt("ILiquidityGauge", m.getParameter("LiquidityGaugeImplementation"));
  const LiquidityGaugeInitializer = m.encodeFunctionCall(LiquidityGaugeImplementation, "initialize", [
    FxUSDBasePoolProxy,
  ]);
  const FxUSDBasePoolGaugeProxyV2 = m.contract(
    "TransparentUpgradeableProxy",
    [LiquidityGaugeImplementation, FxProxyAdmin, LiquidityGaugeInitializer],
    {
      id: "FxUSDBasePoolGaugeProxyV2",
    }
  );
  const LinearMultipleRewardDistributor = m.contractAt("LinearMultipleRewardDistributor", FxUSDBasePoolGaugeProxyV2);
  const FxUSDBasePoolGaugeGrantRoleCall = m.call(LinearMultipleRewardDistributor, "grantRole", [
    id("REWARD_MANAGER_ROLE"),
    admin,
  ]);
  m.call(LinearMultipleRewardDistributor, "registerRewardToken", [EthereumTokens.FXN.address, GaugeRewarder], {
    id: "FxUSDBasePoolGaugeV2_registerRewardToken_FXN",
    after: [FxUSDBasePoolGaugeGrantRoleCall],
  });
  // deploy SavingFxUSDProxy
  const SavingFxUSDProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, CustomProxyAdmin, "0x"], {
    id: "SavingFxUSDProxy",
  });
  // deploy RewardHarvester
  const RewardHarvester = m.contract("RewardHarvester", [SavingFxUSDProxy]);
  // deploy SavingFxUSD implementation and initialize SavingFxUSD proxy
  const SavingFxUSDImplementation = m.contract(
    "SavingFxUSD",
    [FxUSDBasePoolProxy, m.getParameter("FxUSDBasePoolGaugeProxyV1")],
    {
      id: "SavingFxUSDImplementation",
    }
  );
  const SavingFxUSDInitializer = m.encodeFunctionCall(SavingFxUSDImplementation, "initialize", [
    admin,
    {
      name: m.getParameter("FxSaveName"),
      symbol: m.getParameter("FxSaveSymbol"),
      pid: m.getParameter("pid"),
      threshold: m.getParameter("Threshold"),
      treasury: m.getParameter("Treasury"),
      harvester: RewardHarvester,
    },
  ]);
  const SavingFxUSDProxyUpgradeAndInitializeCall = m.call(
    CustomProxyAdmin,
    "upgradeAndCall",
    [SavingFxUSDProxy, SavingFxUSDImplementation, SavingFxUSDInitializer],
    {
      id: "SavingFxUSDProxy_upgradeAndCall",
    }
  );
  // change admin
  m.call(CustomProxyAdmin, "changeProxyAdmin", [SavingFxUSDProxy, FxProxyAdmin], {
    id: "SavingFxUSDProxy_changeProxyAdmin",
    after: [SavingFxUSDProxyUpgradeAndInitializeCall],
  });

  // deploy AaveV3Strategy for FxUSDBasePool
  const AaveV3StrategyUSDC = m.contract(
    "AaveV3Strategy",
    [
      admin,
      FxUSDBasePoolProxy,
      "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      "0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb",
      EthereumTokens.USDC.address,
      "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c",
    ],
    { id: "AaveV3StrategyUSDC" }
  );
  // deploy AaveV3Strategy for PoolManager
  const AaveV3StrategyWstETH = m.contract(
    "AaveV3Strategy",
    [
      admin,
      PoolManagerProxy,
      "0x4e033931ad43597d96D6bcc25c280717730B58B1",
      "0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb",
      EthereumTokens.wstETH.address,
      "0xC035a7cf15375cE2706766804551791aD035E0C2",
    ],
    { id: "AaveV3StrategyWstETH" }
  );
  // deploy SavingFxUSDFacet
  const SavingFxUSDFacet = m.contract("SavingFxUSDFacet", [FxUSDBasePoolProxy, SavingFxUSDProxy]);

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
  m.call(WBTCPriceOracle, "updateMaxPriceDeviation", [2n * 10n ** 16n]); // 2%

  // deploy WBTCPool proxy
  const WBTCPoolInitializer = m.encodeFunctionCall(AaveFundingPoolImplementation, "initialize", [
    admin,
    m.getParameter("FxWBTCName"),
    m.getParameter("FxWBTCSymbol"),
    EthereumTokens.WBTC.address,
    WBTCPriceOracle,
  ]);
  const WBTCPoolProxy = m.contract(
    "TransparentUpgradeableProxy",
    [AaveFundingPoolImplementation, FxProxyAdmin, WBTCPoolInitializer],
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
  const grantRole = m.call(WBTCPool, "grantRole", [id("EMERGENCY_ROLE"), admin]);
  m.call(WBTCPool, "updateBorrowAndRedeemStatus", [true, true], { after: [grantRole] });
  m.call(WBTCPool, "updateOpenRatio", [m.getParameter("OpenRatio"), m.getParameter("OpenRatioStep")]);
  m.call(WBTCPool, "updateCloseFeeRatio", [m.getParameter("CloseFeeRatio")]);
  m.call(WBTCPool, "updateFundingRatio", [m.getParameter("FundingRatio")]);

  // deploy StETHPriceOracle
  const StETHPriceOracle = m.contract("StETHPriceOracle", [
    m.getParameter("SpotPriceOracle"),
    encodeChainlinkPriceFeed(
      ChainlinkPriceFeed.ethereum["ETH-USD"].feed,
      ChainlinkPriceFeed.ethereum["ETH-USD"].scale,
      ChainlinkPriceFeed.ethereum["ETH-USD"].heartbeat
    ),
    Addresses["CRV_SP_ETH/stETH_303"],
  ]);
  m.call(StETHPriceOracle, "updateOnchainSpotEncodings", [SpotPriceEncodings["WETH/USDC"], 0], {
    id: "StETH_onchainSpotEncodings_ETHUSD",
  });
  m.call(StETHPriceOracle, "updateOnchainSpotEncodings", [SpotPriceEncodings["stETH/WETH"], 1], {
    id: "StETH_onchainSpotEncodings_LSDETH",
  });

  const PlatformSplitterV2 = m.contract(
    "RevenuePool",
    [m.getParameter("Treasury"), m.getParameter("Treasury"), "0x11E91BB6d1334585AA37D8F4fde3932C7960B938"],
    {
      id: "PlatformSplitterV2",
    }
  );

  // upgrade facets
  const DiamondCutFacet = m.contractAt("DiamondCutFacet", Router);
  m.call(DiamondCutFacet, "diamondCut", [
    [
      {
        facetAddress: PositionOperateFlashLoanFacetV2,
        action: 0,
        functionSelectors: getAllSignatures(PositionOperateFlashLoanFacetV2__factory.createInterface()),
      },
      {
        facetAddress: MorphoFlashLoanCallbackFacet,
        action: 0,
        functionSelectors: getAllSignatures(MorphoFlashLoanCallbackFacet__factory.createInterface()),
      },
      {
        facetAddress: FxUSDBasePoolV2Facet,
        action: 0,
        functionSelectors: getAllSignatures(FxUSDBasePoolV2Facet__factory.createInterface()),
      },
      {
        facetAddress: SavingFxUSDFacet,
        action: 0,
        functionSelectors: getAllSignatures(SavingFxUSDFacet__factory.createInterface()),
      },
    ],
    ZeroAddress,
    "0x",
  ]);
  const RouterManagementFacet = m.contractAt("RouterManagementFacet", Router);
  m.call(RouterManagementFacet, "updateWhitelist", [m.getParameter("FxUSDBasePoolGaugeProxyV1"), true], {
    id: "Router_updateWhitelist_old_gauge",
  });
  m.call(RouterManagementFacet, "updateWhitelist", [FxUSDBasePoolGaugeProxyV2, true], {
    id: "Router_updateWhitelist_new_gauge",
  });

  return {
    RewardHarvester,
    FxUSDBasePoolGaugeProxyV2,
    SavingFxUSDProxy,
    SavingFxUSDFacet,
    AaveV3StrategyUSDC,
    AaveV3StrategyWstETH,

    StETHPriceOracle,
    PlatformSplitterV2,

    WBTCPool,
    WBTCPriceOracle,
  };
});
