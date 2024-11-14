import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "ethers";

import { encodeChainlinkPriceFeed } from "@/utils/codec";
import { ChainlinkPriceFeed } from "@/utils/oracle";
import { EthereumTokens } from "@/utils/tokens";

import FxProtocolProxiesModule from "./FxProtocolProxies";
import ProxyAdminModule from "./ProxyAdmin";
import TokenConverterModule from "./TokenConverter";

export default buildModule("FxProtocol", (m) => {
  const admin = m.getAccount(0);
  const { fx: ProxyAdmin } = m.useModule(ProxyAdminModule);
  const { PoolManagerProxy, StakedFxUSDProxy, PegKeeperProxy, FxUSDProxy } = m.useModule(FxProtocolProxiesModule);
  const { MultiPathConverter } = m.useModule(TokenConverterModule);

  // deploy ReservePool
  const ReservePool = m.contract("ReservePool", [admin, PoolManagerProxy]);

  // deploy PoolManager implementation and initialize PoolManager proxy
  const PoolManagerImplementation = m.contract("PoolManager", [FxUSDProxy, StakedFxUSDProxy, PegKeeperProxy]);
  const PoolManagerInitializer = m.encodeFunctionCall(PoolManagerImplementation, "initialize", [
    admin,
    m.getParameter("ExpenseRatio"),
    m.getParameter("HarvesterRatio"),
    m.getParameter("FlashLoanFeeRatio"),
    m.getParameter("platform"),
    ReservePool,
  ]);
  m.call(ProxyAdmin, "upgradeAndCall", [PoolManagerProxy, PoolManagerImplementation, PoolManagerInitializer]);

  // deploy StakedFxUSD implementation and initialize StakedFxUSD proxy
  const StakedFxUSDImplementation = m.contract("StakedFxUSD", [
    PoolManagerProxy,
    PegKeeperProxy,
    FxUSDProxy,
    EthereumTokens.USDC.address,
    "0x" +
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["USDC-USD"].feed,
        10n ** 10n,
        ChainlinkPriceFeed.ethereum["USDC-USD"].heartbeat
      )
        .toString(16)
        .padStart(64, "0"),
  ]);
  const StakedFxUSDInitializer = m.encodeFunctionCall(StakedFxUSDImplementation, "initialize", [
    admin,
    "Staked FxUSD",
    "sfxUSD",
    ethers.parseEther("0.995"),
  ]);
  m.call(ProxyAdmin, "upgradeAndCall", [StakedFxUSDProxy, StakedFxUSDImplementation, StakedFxUSDInitializer]);

  // deploy PegKeeper implementation and initialize PegKeeper proxy
  const PegKeeperImplementation = m.contract("PegKeeper", [StakedFxUSDProxy]);
  const PegKeeperInitializer = m.encodeFunctionCall(PegKeeperImplementation, "initialize", [admin, MultiPathConverter]);
  m.call(ProxyAdmin, "upgradeAndCall", [PegKeeperProxy, PegKeeperImplementation, PegKeeperInitializer]);

  // deploy FxUSD implementation and initialize FxUSD proxy
  const FxUSDImplementation = m.contract("FxUSDRegeneracy", [PoolManagerProxy, m.getParameter("USDC"), PegKeeperProxy]);
  const FxUSDInitializerV2 = m.encodeFunctionCall(FxUSDImplementation, "initializeV2", []);
  m.call(ProxyAdmin, "upgradeAndCall", [FxUSDProxy, FxUSDImplementation, FxUSDInitializerV2]);

  // deploy SfxUSDRewarder
  const SfxUSDRewarder = m.contract("SfxUSDRewarder", [StakedFxUSDProxy]);

  return {
    PoolManagerProxy: m.contractAt("PoolManager", PoolManagerProxy),
    PoolManagerImplementation,
    StakedFxUSDProxy: m.contractAt("PoolManager", StakedFxUSDProxy),
    StakedFxUSDImplementation,
    PegKeeperProxy: m.contractAt("PoolManager", PegKeeperProxy),
    PegKeeperImplementation,
    FxUSDProxy: m.contractAt("PoolManager", FxUSDProxy),
    FxUSDImplementation,
    SfxUSDRewarder,
  };
});
