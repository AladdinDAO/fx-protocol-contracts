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
  // deploy FxUSDSaveProxy
  const FxUSDSaveProxy = m.contract("TransparentUpgradeableProxy", [EmptyContract, ProxyAdmin, "0x"], {
    id: "FxUSDSaveProxy",
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
  const PoolManagerImplementation = m.contract("PoolManager", [FxUSDProxy, FxUSDSaveProxy, PegKeeperProxy], {
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

  // deploy FxUSDSave implementation and initialize FxUSDSave proxy
  const FxUSDSaveImplementation = m.contract(
    "FxUSDSave",
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
    { id: "FxUSDSaveImplementation" }
  );
  const FxUSDSaveInitializer = m.encodeFunctionCall(FxUSDSaveImplementation, "initialize", [
    admin,
    "fxUSD Save",
    "fxSAVE",
    ethers.parseEther("0.995"),
  ]);
  const FxUSDSaveProxyUpgradeAndInitializeCall = m.call(
    ProxyAdmin,
    "upgradeAndCall",
    [FxUSDSaveProxy, FxUSDSaveImplementation, FxUSDSaveInitializer],
    {
      id: "FxUSDSaveProxy_upgradeAndCall",
    }
  );

  // deploy PegKeeper implementation and initialize PegKeeper proxy
  const PegKeeperImplementation = m.contract("PegKeeper", [FxUSDSaveProxy], {
    id: "PegKeeperImplementation",
    after: [FxUSDSaveProxyUpgradeAndInitializeCall],
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

  // deploy FxSaveRewarder
  const FxSaveRewarder = m.contract("FxSaveRewarder", [FxUSDSaveProxy], {
    after: [FxUSDSaveProxyUpgradeAndInitializeCall],
  });

  const FxUSDSave = m.contractAt("FxUSDSave", FxUSDSaveProxy, { id: "FxUSDSave" });
  m.call(FxUSDSave, "grantRole", [id("REWARD_DEPOSITOR_ROLE"), FxSaveRewarder]);

  return {
    ReservePool,
    PoolManagerProxy: m.contractAt("PoolManager", PoolManagerProxy, { id: "PoolManager" }),
    PoolManagerImplementation,
    FxUSDSaveProxy: FxUSDSave,
    FxUSDSaveImplementation,
    PegKeeperProxy: m.contractAt("PegKeeper", PegKeeperProxy, { id: "PegKeeper" }),
    PegKeeperImplementation,
    FxUSDProxy: m.contractAt("FxUSDRegeneracy", FxUSDProxy, { id: "FxUSD" }),
    FxUSDImplementation,
    FxSaveRewarder,
  };
});
