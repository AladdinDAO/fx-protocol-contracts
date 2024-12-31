import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers, id, ZeroAddress } from "ethers";

import { Addresses, ChainlinkPriceFeed, encodeChainlinkPriceFeed, EthereumTokens } from "@/utils/index";

import EmptyContractModule from "./EmptyContract";
import ProxyAdminModule from "./ProxyAdmin";
import TokenConverterModule from "./TokenConverter";

export default buildModule("FxProtocol", (m) => {
  const admin = m.getAccount(0);
  const { fx: ProxyAdmin } = m.useModule(ProxyAdminModule);
  const { EmptyContract } = m.useModule(EmptyContractModule);
  const { MultiPathConverter } = m.useModule(TokenConverterModule);

  // deploy PoolManagerProxy
  const PoolManagerProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, ProxyAdmin, "0x"], {
    id: "PoolManagerProxy",
  });
  // deploy PegKeeperProxy
  const PegKeeperProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, ProxyAdmin, "0x"], {
    id: "PegKeeperProxy",
  });
  // deploy FxUSDBasePoolProxy
  const FxUSDBasePoolProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, ProxyAdmin, "0x"], {
    id: "FxUSDBasePoolProxy",
  });
  // deploy or get FxUSDProxy
  let FxUSDProxy;
  FxUSDProxy = m.contractAt("TransparentUpgradeableProxy", m.getParameter("FxUSDProxy", ZeroAddress), {
    id: "FxUSDProxy",
  });
  if (FxUSDProxy.address === ZeroAddress) {
    FxUSDProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, ProxyAdmin, "0x"], { id: "FxUSDProxy" });
  }

  // deploy ReservePool
  const ReservePool = m.contract("ReservePool", [admin, PoolManagerProxy]);
  // deploy ReservePool
  const RevenuePool = m.contract("RevenuePool", [m.getParameter("Treasury"), m.getParameter("Treasury"), admin]);

  // deploy PoolManager implementation and initialize PoolManager proxy
  const PoolManagerImplementation = m.contract("PoolManager", [FxUSDProxy, FxUSDBasePoolProxy, PegKeeperProxy], {
    id: "PoolManagerImplementation",
  });
  const PoolManagerInitializer = m.encodeFunctionCall(PoolManagerImplementation, "initialize", [
    admin,
    m.getParameter("ExpenseRatio"),
    m.getParameter("HarvesterRatio"),
    m.getParameter("FlashLoanFeeRatio"),
    m.getParameter("Treasury"),
    RevenuePool,
    ReservePool,
  ]);
  m.call(ProxyAdmin, "upgradeAndCall", [PoolManagerProxy, PoolManagerImplementation, PoolManagerInitializer], {
    id: "PoolManagerProxy_upgradeAndCall",
  });

  // deploy FxUSDBasePool implementation and initialize FxUSDBasePool proxy
  const FxUSDBasePoolImplementation = m.contract(
    "FxUSDBasePool",
    [
      PoolManagerProxy,
      PegKeeperProxy,
      FxUSDProxy,
      EthereumTokens.USDC.address,
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["USDC-USD"].feed,
        ChainlinkPriceFeed.ethereum["USDC-USD"].scale,
        ChainlinkPriceFeed.ethereum["USDC-USD"].heartbeat
      ),
    ],
    { id: "FxUSDBasePoolImplementation" }
  );
  const FxUSDBasePoolInitializer = m.encodeFunctionCall(FxUSDBasePoolImplementation, "initialize", [
    admin,
    "fxUSD Save",
    "fxBASE",
    ethers.parseEther("0.995"),
    m.getParameter("RedeemCoolDownPeriod"),
  ]);
  const FxUSDBasePoolProxyUpgradeAndInitializeCall = m.call(
    ProxyAdmin,
    "upgradeAndCall",
    [FxUSDBasePoolProxy, FxUSDBasePoolImplementation, FxUSDBasePoolInitializer],
    {
      id: "FxUSDBasePoolProxy_upgradeAndCall",
    }
  );

  // deploy PegKeeper implementation and initialize PegKeeper proxy
  const PegKeeperImplementation = m.contract("PegKeeper", [FxUSDBasePoolProxy], {
    id: "PegKeeperImplementation",
    after: [FxUSDBasePoolProxyUpgradeAndInitializeCall],
  });
  const PegKeeperInitializer = m.encodeFunctionCall(PegKeeperImplementation, "initialize", [
    admin,
    MultiPathConverter,
    Addresses["CRV_SN_USDC/fxUSD_193"],
  ]);
  m.call(ProxyAdmin, "upgradeAndCall", [PegKeeperProxy, PegKeeperImplementation, PegKeeperInitializer], {
    id: "PegKeeperProxy_upgradeAndCall",
  });

  // deploy FxUSD implementation and initialize FxUSD proxy
  const FxUSDImplementation = m.contract(
    "FxUSDRegeneracy",
    [PoolManagerProxy, EthereumTokens.USDC.address, PegKeeperProxy],
    { id: "FxUSDImplementation" }
  );
  const FxUSDInitializerV2 = m.encodeFunctionCall(FxUSDImplementation, "initializeV2", []);
  m.call(ProxyAdmin, "upgradeAndCall", [FxUSDProxy, FxUSDImplementation, FxUSDInitializerV2], {
    id: "FxUSDProxy_upgradeAndCall",
  });

  // deploy FxUSDBasePool Gauge
  const LiquidityGaugeImplementation = m.contractAt("ILiquidityGauge", "0xF62F458D2F6dd2AD074E715655064d7632e136D6");
  const LiquidityGaugeInitializer = m.encodeFunctionCall(LiquidityGaugeImplementation, "initialize", [
    FxUSDBasePoolProxy,
  ]);
  const FxUSDBasePoolGaugeProxy = m.contract(
    "TransparentUpgradeableProxy",
    [LiquidityGaugeImplementation, ProxyAdmin, LiquidityGaugeInitializer],
    {
      id: "FxUSDBasePoolGaugeProxy",
      after: [FxUSDBasePoolProxyUpgradeAndInitializeCall],
    }
  );

  // deploy GaugeRewarder
  const GaugeRewarder = m.contract("GaugeRewarder", [FxUSDBasePoolGaugeProxy]);

  const LinearMultipleRewardDistributor = m.contractAt("LinearMultipleRewardDistributor", FxUSDBasePoolGaugeProxy);
  m.call(LinearMultipleRewardDistributor, "grantRole", [id("REWARD_MANAGER_ROLE"), admin]);
  m.call(LinearMultipleRewardDistributor, "registerRewardToken", [EthereumTokens.wstETH.address, GaugeRewarder]);

  return {
    ReservePool,
    PoolManagerProxy: m.contractAt("PoolManager", PoolManagerProxy, { id: "PoolManager" }),
    PoolManagerImplementation,
    FxUSDBasePoolProxy: m.contractAt("FxUSDBasePool", FxUSDBasePoolProxy, { id: "FxUSDBasePool" }),
    FxUSDBasePoolImplementation,
    PegKeeperProxy: m.contractAt("PegKeeper", PegKeeperProxy, { id: "PegKeeper" }),
    PegKeeperImplementation,
    FxUSDProxy: m.contractAt("FxUSDRegeneracy", FxUSDProxy, { id: "FxUSD" }),
    FxUSDImplementation,
    FxUSDBasePoolGaugeProxy,
    RevenuePool,
    GaugeRewarder,
  };
});
