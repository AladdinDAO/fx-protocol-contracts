import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { id, ZeroHash } from "ethers";

import FxProtocolModule from "./FxProtocol";
import ProxyAdminModule from "./ProxyAdmin";
import WBTCPoolModule from "./pools/WBTCPool";
import WeETHPoolModule from "./pools/WeETHPool";
import KatanaFxMintModule from "./KatanaFxMint";
import FxUSDPriceOracleModule from "./FxUSDPriceOracle";

const DEFAULT_ADMIN_ROLE = ZeroHash;
const MINTER_ROLE = id("MINTER_ROLE");

export default buildModule("KatanaTransferAuthority", (m) => {
  const admin = m.getAccount(0);
  const Treasury = m.getParameter("Treasury");

  // Import all contracts
  const { fx: FxProxyAdmin } = m.useModule(ProxyAdminModule);
  const {
    PoolManagerProxy: PoolManager,
    FxUSDProxy: FxUSD,
    FxUSDBasePoolProxy: FxUSDBasePool,
    PegKeeperProxy: PegKeeper,
    PoolConfiguration,
    ReservePool,
    RevenuePool,
    GaugeRewarder,
    ProtocolTreasuryProxy,
  } = m.useModule(FxProtocolModule);
  const { FxUSDPriceOracle } = m.useModule(FxUSDPriceOracleModule);
  const { WBTCPool } = m.useModule(WBTCPoolModule);
  const { WeETHPool } = m.useModule(WeETHPoolModule);
  const { FxMintRouter } = m.useModule(KatanaFxMintModule);

  // =============================================
  // Part 1: Transfer remaining fxUSD to Treasury
  // =============================================
  const balance = m.staticCall(FxUSD, "balanceOf", [admin], 0, { id: "FxUSD_balanceOf" });
  const transferFxUSD = m.call(FxUSD, "transfer", [Treasury, balance], { id: "FxUSD_transfer_to_Treasury" });

  // =============================================
  // Part 2: Transfer all admin authorities
  // =============================================

  // --- 1. PoolManager ---
  const PoolManager_grantRole = m.call(PoolManager, "grantRole", [DEFAULT_ADMIN_ROLE, Treasury], {
    id: "PoolManager_grantRole",
    after: [transferFxUSD],
  });
  m.call(PoolManager, "renounceRole", [DEFAULT_ADMIN_ROLE, admin], {
    id: "PoolManager_renounceRole",
    after: [PoolManager_grantRole],
  });

  // --- 2. FxUSD (FxUSDRegeneracy) — DEFAULT_ADMIN_ROLE + MINTER_ROLE ---
  const FxUSD_grantAdminRole = m.call(FxUSD, "grantRole", [DEFAULT_ADMIN_ROLE, Treasury], {
    id: "FxUSD_grantAdminRole",
    after: [transferFxUSD],
  });
  m.call(FxUSD, "renounceRole", [DEFAULT_ADMIN_ROLE, admin], {
    id: "FxUSD_renounceAdminRole",
    after: [FxUSD_grantAdminRole],
  });
  const FxUSD_grantMinterRole = m.call(FxUSD, "grantRole", [MINTER_ROLE, Treasury], {
    id: "FxUSD_grantMinterRole",
    after: [transferFxUSD],
  });
  m.call(FxUSD, "renounceRole", [MINTER_ROLE, admin], {
    id: "FxUSD_renounceMinterRole",
    after: [FxUSD_grantMinterRole],
  });

  // --- 3. FxUSDBasePool ---
  const FxUSDBasePool_grantRole = m.call(FxUSDBasePool, "grantRole", [DEFAULT_ADMIN_ROLE, Treasury], {
    id: "FxUSDBasePool_grantRole",
    after: [transferFxUSD],
  });
  m.call(FxUSDBasePool, "renounceRole", [DEFAULT_ADMIN_ROLE, admin], {
    id: "FxUSDBasePool_renounceRole",
    after: [FxUSDBasePool_grantRole],
  });

  // --- 4. PegKeeper ---
  const PegKeeper_grantRole = m.call(PegKeeper, "grantRole", [DEFAULT_ADMIN_ROLE, Treasury], {
    id: "PegKeeper_grantRole",
    after: [transferFxUSD],
  });
  m.call(PegKeeper, "renounceRole", [DEFAULT_ADMIN_ROLE, admin], {
    id: "PegKeeper_renounceRole",
    after: [PegKeeper_grantRole],
  });

  // --- 5. PoolConfiguration ---
  const PoolConfiguration_grantRole = m.call(PoolConfiguration, "grantRole", [DEFAULT_ADMIN_ROLE, Treasury], {
    id: "PoolConfiguration_grantRole",
    after: [transferFxUSD],
  });
  m.call(PoolConfiguration, "renounceRole", [DEFAULT_ADMIN_ROLE, admin], {
    id: "PoolConfiguration_renounceRole",
    after: [PoolConfiguration_grantRole],
  });

  // --- 6. ReservePool ---
  const ReservePool_grantRole = m.call(ReservePool, "grantRole", [DEFAULT_ADMIN_ROLE, Treasury], {
    id: "ReservePool_grantRole",
    after: [transferFxUSD],
  });
  m.call(ReservePool, "renounceRole", [DEFAULT_ADMIN_ROLE, admin], {
    id: "ReservePool_renounceRole",
    after: [ReservePool_grantRole],
  });

  // --- 7. ProtocolTreasury ---
  const ProtocolTreasury = m.contractAt("ProtocolTreasury", ProtocolTreasuryProxy, { id: "ProtocolTreasury" });
  const ProtocolTreasury_grantRole = m.call(ProtocolTreasury, "grantRole", [DEFAULT_ADMIN_ROLE, Treasury], {
    id: "ProtocolTreasury_grantRole",
    after: [transferFxUSD],
  });
  m.call(ProtocolTreasury, "renounceRole", [DEFAULT_ADMIN_ROLE, admin], {
    id: "ProtocolTreasury_renounceRole",
    after: [ProtocolTreasury_grantRole],
  });

  // --- 8. GaugeRewarder ---
  const GaugeRewarder_grantRole = m.call(GaugeRewarder, "grantRole", [DEFAULT_ADMIN_ROLE, Treasury], {
    id: "GaugeRewarder_grantRole",
    after: [transferFxUSD],
  });
  m.call(GaugeRewarder, "renounceRole", [DEFAULT_ADMIN_ROLE, admin], {
    id: "GaugeRewarder_renounceRole",
    after: [GaugeRewarder_grantRole],
  });

  // --- 9. FxUSDPriceOracle ---
  const FxUSDPriceOracle_grantRole = m.call(FxUSDPriceOracle, "grantRole", [DEFAULT_ADMIN_ROLE, Treasury], {
    id: "FxUSDPriceOracle_grantRole",
    after: [transferFxUSD],
  });
  m.call(FxUSDPriceOracle, "renounceRole", [DEFAULT_ADMIN_ROLE, admin], {
    id: "FxUSDPriceOracle_renounceRole",
    after: [FxUSDPriceOracle_grantRole],
  });

  // --- 10. WBTCPool ---
  const WBTCPool_grantRole = m.call(WBTCPool, "grantRole", [DEFAULT_ADMIN_ROLE, Treasury], {
    id: "WBTCPool_grantRole",
    after: [transferFxUSD],
  });
  m.call(WBTCPool, "renounceRole", [DEFAULT_ADMIN_ROLE, admin], {
    id: "WBTCPool_renounceRole",
    after: [WBTCPool_grantRole],
  });

  // --- 11. WeETHPool ---
  const WeETHPool_grantRole = m.call(WeETHPool, "grantRole", [DEFAULT_ADMIN_ROLE, Treasury], {
    id: "WeETHPool_grantRole",
    after: [transferFxUSD],
  });
  m.call(WeETHPool, "renounceRole", [DEFAULT_ADMIN_ROLE, admin], {
    id: "WeETHPool_renounceRole",
    after: [WeETHPool_grantRole],
  });

  // --- 12. RevenuePool (Ownable) ---
  m.call(RevenuePool, "transferOwnership", [Treasury], {
    id: "RevenuePool_transferOwnership",
    after: [transferFxUSD],
  });

  // --- 13. FxMintRouter (Diamond — OwnershipFacet) ---
  const FxMintRouterOwnership = m.contractAt("OwnershipFacet", FxMintRouter, { id: "FxMintRouterOwnership" });
  m.call(FxMintRouterOwnership, "transferOwnership", [Treasury], {
    id: "FxMintRouter_transferOwnership",
    after: [transferFxUSD],
  });

  // --- 14. FxProxyAdmin (MUST BE LAST) ---
  m.call(FxProxyAdmin, "transferOwnership", [Treasury], {
    id: "FxProxyAdmin_transferOwnership",
    after: [
      transferFxUSD,
      PoolManager_grantRole,
      FxUSD_grantAdminRole,
      FxUSD_grantMinterRole,
      FxUSDBasePool_grantRole,
      PegKeeper_grantRole,
      PoolConfiguration_grantRole,
      ReservePool_grantRole,
      ProtocolTreasury_grantRole,
      GaugeRewarder_grantRole,
      FxUSDPriceOracle_grantRole,
      WBTCPool_grantRole,
      WeETHPool_grantRole,
    ],
  });

  return {};
});
