import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers, ZeroAddress } from "ethers";

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
  // deploy StakedFxUSDProxy
  const StakedFxUSDProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, ProxyAdmin, "0x"], {
    id: "StakedFxUSDProxy",
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

  // deploy PoolManager implementation and initialize PoolManager proxy
  const PoolManagerImplementation = m.contract("PoolManager", [FxUSDProxy, StakedFxUSDProxy, PegKeeperProxy], {
    id: "PoolManagerImplementation",
  });
  const PoolManagerInitializer = m.encodeFunctionCall(PoolManagerImplementation, "initialize", [
    admin,
    m.getParameter("ExpenseRatio"),
    m.getParameter("HarvesterRatio"),
    m.getParameter("FlashLoanFeeRatio"),
    m.getParameter("Platform"),
    ReservePool,
  ]);
  m.call(ProxyAdmin, "upgradeAndCall", [PoolManagerProxy, PoolManagerImplementation, PoolManagerInitializer], {
    id: "PoolManagerProxy_upgradeAndCall",
  });

  // deploy StakedFxUSD implementation and initialize StakedFxUSD proxy
  const StakedFxUSDImplementation = m.contract(
    "StakedFxUSD",
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
    { id: "StakedFxUSDImplementation" }
  );
  const StakedFxUSDInitializer = m.encodeFunctionCall(StakedFxUSDImplementation, "initialize", [
    admin,
    "Staked FxUSD",
    "sfxUSD",
    ethers.parseEther("0.995"),
  ]);
  const StakedFxUSDProxyUpgradeAndInitializeCall = m.call(
    ProxyAdmin,
    "upgradeAndCall",
    [StakedFxUSDProxy, StakedFxUSDImplementation, StakedFxUSDInitializer],
    {
      id: "StakedFxUSDProxy_upgradeAndCall",
    }
  );

  // deploy PegKeeper implementation and initialize PegKeeper proxy
  const PegKeeperImplementation = m.contract("PegKeeper", [StakedFxUSDProxy], {
    id: "PegKeeperImplementation",
    after: [StakedFxUSDProxyUpgradeAndInitializeCall],
  });
  const PegKeeperInitializer = m.encodeFunctionCall(PegKeeperImplementation, "initialize", [
    admin,
    MultiPathConverter,
    Addresses["CRV_S_NG_USDC/fxUSD_193"],
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

  // deploy SfxUSDRewarder
  const SfxUSDRewarder = m.contract("SfxUSDRewarder", [StakedFxUSDProxy], {
    after: [StakedFxUSDProxyUpgradeAndInitializeCall],
  });

  return {
    ReservePool,
    PoolManagerProxy: m.contractAt("PoolManager", PoolManagerProxy, { id: "PoolManager" }),
    PoolManagerImplementation,
    StakedFxUSDProxy: m.contractAt("StakedFxUSD", StakedFxUSDProxy, { id: "StakedFxUSD" }),
    StakedFxUSDImplementation,
    PegKeeperProxy: m.contractAt("PegKeeper", PegKeeperProxy, { id: "PegKeeper" }),
    PegKeeperImplementation,
    FxUSDProxy: m.contractAt("FxUSDRegeneracy", FxUSDProxy, { id: "FxUSD" }),
    FxUSDImplementation,
    SfxUSDRewarder,
  };
});
