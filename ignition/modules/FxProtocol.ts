import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers, id, ZeroAddress } from "ethers";

import { KatanaTokens } from "@/utils/index";

import EmptyContractModule from "./EmptyContract";
import ProxyAdminModule from "./ProxyAdmin";
import FxUSDPriceOracleModule from "./FxUSDPriceOracle";
import ProxiesModule from "./Proxies";

export default buildModule("FxProtocol", (m) => {
  const admin = m.getAccount(0);
  const { fx: FxProxyAdmin } = m.useModule(ProxyAdminModule);
  const { FxUSDProxy, FxUSDPriceOracle } = m.useModule(FxUSDPriceOracleModule);
  const { PoolManagerProxy, PoolConfigurationProxy, FxUSDBasePoolProxy, ShortPoolManagerProxy, PegKeeperProxy } =
    m.useModule(ProxiesModule);
  const { EmptyContract } = m.useModule(EmptyContractModule);
  // const { MultiPathConverter } = m.useModule(TokenConverterModule);

  // deploy ReservePool
  const ReservePool = m.contract("ReservePool", [admin, PoolManagerProxy]);
  m.call(ReservePool, "grantRole", [id("POOL_MANAGER_ROLE"), PoolManagerProxy], {
    id: "ReservePool_grant_POOL_MANAGER_ROLE_PoolManager",
  });
  // deploy ReservePool
  const RevenuePool = m.contract("RevenuePool", [
    m.getParameter("Treasury"),
    m.getParameter("Treasury"),
    m.getParameter("Staker"),
  ]);

  // deploy PoolManager implementation and initialize PoolManager proxy
  const PoolManagerImplementation = m.contract(
    "PoolManager",
    [FxUSDProxy, FxUSDBasePoolProxy, ShortPoolManagerProxy, PoolConfigurationProxy, ZeroAddress],
    {
      id: "PoolManagerImplementation",
    },
  );
  const PoolManagerInitializer = m.encodeFunctionCall(PoolManagerImplementation, "initialize", [
    admin,
    0n,
    m.getParameter("HarvesterRatio"),
    m.getParameter("FlashLoanFeeRatio"),
    m.getParameter("Treasury"),
    RevenuePool,
    ReservePool,
  ]);
  const PoolManagerProxyUpgradeAndInitializeCall = m.call(
    FxProxyAdmin,
    "upgradeAndCall",
    [PoolManagerProxy, PoolManagerImplementation, PoolManagerInitializer],
    {
      id: "PoolManagerProxy_upgradeAndCall",
    },
  );

  // deploy FxUSDBasePool implementation and initialize FxUSDBasePool proxy
  const FxUSDBasePoolImplementation = m.contract(
    "FxUSDBasePool",
    [PoolManagerProxy, PegKeeperProxy, FxUSDProxy, KatanaTokens.USDC.address, FxUSDPriceOracle],
    { id: "FxUSDBasePoolImplementation" },
  );
  const FxUSDBasePoolInitializer = m.encodeFunctionCall(FxUSDBasePoolImplementation, "initialize", [
    admin,
    "fxUSD Save",
    "fxBASE",
    m.getParameter("StableDepegPrice"),
    m.getParameter("RedeemCoolDownPeriod"),
  ]);
  const FxUSDBasePoolProxyUpgradeAndInitializeCall = m.call(
    FxProxyAdmin,
    "upgradeAndCall",
    [FxUSDBasePoolProxy, FxUSDBasePoolImplementation, FxUSDBasePoolInitializer],
    {
      id: "FxUSDBasePoolProxy_upgradeAndCall",
    },
  );

  // deploy PegKeeper implementation and initialize PegKeeper proxy
  const PegKeeperImplementation = m.contract("PegKeeper", [FxUSDBasePoolProxy], {
    id: "PegKeeperImplementation",
    after: [FxUSDBasePoolProxyUpgradeAndInitializeCall],
  });
  const PegKeeperInitializer = m.encodeFunctionCall(PegKeeperImplementation, "initialize", [
    admin,
    EmptyContract, // MultiPathConverter
    FxUSDPriceOracle,
  ]);
  m.call(FxProxyAdmin, "upgradeAndCall", [PegKeeperProxy, PegKeeperImplementation, PegKeeperInitializer], {
    id: "PegKeeperProxy_upgradeAndCall",
  });
  const PegKeeper = m.contractAt("PegKeeper", PegKeeperProxy);
  m.call(PegKeeper, "grantRole", [id("BUYBACK_ROLE"), m.getParameter("Keeper")], {
    id: "PegKeeper_grant_BUYBACK_ROLE_PoolManager",
  });
  m.call(PegKeeper, "grantRole", [id("STABILIZE_ROLE"), m.getParameter("Keeper")], {
    id: "PegKeeper_grant_BUYBACK_ROLE_PoolManager",
  });

  /*
  // deploy FxUSDBasePool Gauge
  const LiquidityGaugeImplementation = m.contractAt("ILiquidityGauge", m.getParameter("LiquidityGaugeImplementation"));
  const LiquidityGaugeInitializer = m.encodeFunctionCall(LiquidityGaugeImplementation, "initialize", [
    FxUSDBasePoolProxy,
  ]);
  const FxUSDBasePoolGaugeProxy = m.contract(
    "TransparentUpgradeableProxy",
    [LiquidityGaugeImplementation, FxProxyAdmin, LiquidityGaugeInitializer],
    {
      id: "FxUSDBasePoolGaugeProxy",
      after: [FxUSDBasePoolProxyUpgradeAndInitializeCall],
    }
  );

  // deploy GaugeRewarder
  const GaugeRewarder = m.contract("GaugeRewarder", [FxUSDBasePoolGaugeProxy]);

  const LinearMultipleRewardDistributor = m.contractAt("LinearMultipleRewardDistributor", FxUSDBasePoolGaugeProxy);
  const FxUSDBasePoolGaugeGrantRoleCall = m.call(LinearMultipleRewardDistributor, "grantRole", [
    id("REWARD_MANAGER_ROLE"),
    admin,
  ]);
  m.call(LinearMultipleRewardDistributor, "registerRewardToken", [KatanaTokens.wstETH.address, GaugeRewarder], {
    id: "FxUSDBasePoolGauge_registerRewardToken_wstETH",
    after: [FxUSDBasePoolGaugeGrantRoleCall],
  });
  m.call(LinearMultipleRewardDistributor, "registerRewardToken", [KatanaTokens.FXN.address, GaugeRewarder], {
    id: "FxUSDBasePoolGauge_registerRewardToken_FXN",
    after: [FxUSDBasePoolGaugeGrantRoleCall],
  });
  */

  // config parameters
  const PoolManager = m.contractAt("PoolManager", PoolManagerProxy, { id: "PoolManager" });
  m.call(
    PoolManager,
    "updateExpenseRatio",
    [
      m.getParameter("RewardsExpenseRatio"),
      m.getParameter("FundingExpenseRatio"),
      m.getParameter("LiquidationExpenseRatio"),
    ],
    { after: [PoolManagerProxyUpgradeAndInitializeCall] },
  );
  m.call(PoolManager, "updateRedeemFeeRatio", [m.getParameter("RedeemFeeRatio")], {
    after: [PoolManagerProxyUpgradeAndInitializeCall],
  });
  m.call(PoolManager, "grantRole", [id("HARVESTER_ROLE"), m.getParameter("Harvester")], {
    after: [PoolManagerProxyUpgradeAndInitializeCall],
  });
  m.call(PoolManager, "updateThreshold", [], {
    after: [PoolManagerProxyUpgradeAndInitializeCall],
  });

  // deploy PoolConfiguration
  const PoolConfigurationImplementation = m.contract(
    "PoolConfiguration",
    [FxUSDBasePoolProxy, PoolManagerProxy, ShortPoolManagerProxy],
    { id: "PoolConfigurationImplementation" },
  );

  const PoolConfigurationInitializer = m.encodeFunctionCall(PoolConfigurationImplementation, "initialize", [
    admin,
    FxUSDPriceOracle,
  ]);

  const PoolConfigurationUpgradeAndInitializeCall = m.call(
    FxProxyAdmin,
    "upgradeAndCall",
    [PoolConfigurationProxy, PoolConfigurationImplementation, PoolConfigurationInitializer],
    {
      id: "PoolConfiguration_upgradeAndCall",
    },
  );

  const PoolConfiguration = m.contractAt("PoolConfiguration", PoolConfigurationProxy);

  m.call(PoolConfiguration, "updateStableDepegPrice", [ethers.parseEther("0.995")], {
    after: [PoolConfigurationUpgradeAndInitializeCall],
  });

  m.call(PoolConfiguration, "grantRole", [id("INTEREST_RATE_SET_ROLE"), m.getParameter("Treasury")], {
    after: [PoolConfigurationUpgradeAndInitializeCall],
  });

  // deploy ProtocolTreasury
  const ProtocolTreasuryImplementation = m.contract("ProtocolTreasury", [], {
    id: "ProtocolTreasuryImplementation",
  });
  const ProtocolTreasuryInitializer = m.encodeFunctionCall(ProtocolTreasuryImplementation, "initialize", [admin]);
  const ProtocolTreasuryProxy = m.contract(
    "TransparentUpgradeableProxy",
    [ProtocolTreasuryImplementation, FxProxyAdmin, ProtocolTreasuryInitializer],
    {
      id: "ProtocolTreasuryProxy",
    },
  );
  m.call(PoolConfiguration, "register", [id("PoolRewardsTreasury"), ProtocolTreasuryProxy], {
    after: [PoolConfigurationUpgradeAndInitializeCall],
  });
  m.call(PoolConfiguration, "register", [id("PoolFundingTreasury"), ProtocolTreasuryProxy], {
    after: [PoolConfigurationUpgradeAndInitializeCall],
  });

  return {
    ReservePool,
    PoolManagerProxy: PoolManager,
    PoolManagerImplementation,
    FxUSDBasePoolProxy: m.contractAt("FxUSDBasePool", FxUSDBasePoolProxy, { id: "FxUSDBasePool" }),
    FxUSDBasePoolImplementation,
    PegKeeperProxy: m.contractAt("PegKeeper", PegKeeperProxy, { id: "PegKeeper" }),
    PegKeeperImplementation,
    FxUSDProxy: m.contractAt("FxUSDRegeneracy", FxUSDProxy, { id: "FxUSD" }),
    // FxUSDBasePoolGaugeProxy,
    RevenuePool,
    // GaugeRewarder,
    PoolConfiguration,
    ShortPoolManagerProxy,
    ProtocolTreasuryProxy,
  };
});
