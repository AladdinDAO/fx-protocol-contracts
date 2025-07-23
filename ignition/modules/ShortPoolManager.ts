import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { id, Interface, ZeroAddress } from "ethers";

import { Addresses, EthereumTokens } from "@/utils/index";

import ProxyAdminModule from "./ProxyAdmin";
import { LongPositionEmergencyCloseFacet__factory, ShortPositionOperateFlashLoanFacet__factory } from "@/types/index";
import { ethers } from "hardhat";

const KEEPER = "0x11e91bb6d1334585aa37d8f4fde3932c7960b938";

const getAllSignatures = (e: Interface): string[] => {
  const sigs: string[] = [];
  e.forEachFunction((func, _) => {
    sigs.push(func.selector);
  });
  return sigs;
};

export default buildModule("ShortPoolManager", (m) => {
  const admin = m.getAccount(0);
  const { fx: FxProxyAdmin } = m.useModule(ProxyAdminModule);

  // deploy FxUSDPriceOracle
  const FxUSDPriceOracleImplementation = m.contract("FxUSDPriceOracle", [EthereumTokens.fxUSD.address], {
    id: "FxUSDPriceOraclelementation",
  });
  const FxUSDPriceOracleInitializer = m.encodeFunctionCall(FxUSDPriceOracleImplementation, "initialize", [
    admin,
    Addresses["CRV_SN_USDC/fxUSD_193"],
  ]);
  const FxUSDPriceOracleProxy = m.contract(
    "TransparentUpgradeableProxy",
    [FxUSDPriceOracleImplementation, FxProxyAdmin, FxUSDPriceOracleInitializer],
    {
      id: "FxUSDPriceOracleProxy",
    }
  );
  const FxUSDPriceOracle = m.contractAt("FxUSDPriceOracle", FxUSDPriceOracleProxy);

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
    }
  );
  const ProtocolTreasuryProxyFunding = m.contract(
    "TransparentUpgradeableProxy",
    [ProtocolTreasuryImplementation, FxProxyAdmin, ProtocolTreasuryInitializer],
    {
      id: "ProtocolTreasuryProxy_Funding",
    }
  );

  // deploy PoolConfiguration
  const PoolConfigurationImplementation = m.contract(
    "PoolConfiguration",
    [m.getParameter("FxUSDBasePoolProxy"), m.getParameter("LendingPool"), m.getParameter("BaseAsset")],
    { id: "PoolConfigurationImplementation" }
  );
  const PoolConfigurationInitializer = m.encodeFunctionCall(PoolConfigurationImplementation, "initialize", [
    admin,
    FxUSDPriceOracle,
  ]);
  const PoolConfigurationProxy = m.contract(
    "TransparentUpgradeableProxy",
    [PoolConfigurationImplementation, FxProxyAdmin, PoolConfigurationInitializer],
    {
      id: "PoolConfigurationProxy",
    }
  );
  const PoolConfiguration = m.contractAt("PoolConfiguration", PoolConfigurationProxy);
  m.call(PoolConfiguration, "register", [id("PoolRewardsTreasury"), ProtocolTreasuryProxy], {
    id: "register_PoolRewardsTreasury",
  });
  m.call(PoolConfiguration, "register", [id("PoolFundingTreasury"), ProtocolTreasuryProxyFunding], {
    id: "register_PoolFundingTreasury",
  });

  const PoolManager = m.contractAt("PoolManager", m.getParameter("PoolManagerProxy"));

  // deploy new ReservePool
  const ReservePool = m.contract("ReservePool", [admin, PoolManager]);

  // deploy ShortPoolManager
  const ShortPoolManagerImplementation = m.contract(
    "ShortPoolManager",
    [EthereumTokens.fxUSD.address, PoolManager, PoolConfigurationProxy],
    { id: "ShortPoolManagerImplementation" }
  );
  const ShortPoolManagerInitializer = m.encodeFunctionCall(ShortPoolManagerImplementation, "initialize", [
    admin,
    0n,
    0n,
    0n,
    m.getParameter("Treasury"),
    m.getParameter("OpenRevenuePool"),
    ReservePool,
  ]);
  const ShortPoolManagerProxy = m.contract(
    "TransparentUpgradeableProxy",
    [ShortPoolManagerImplementation, FxProxyAdmin, ShortPoolManagerInitializer],
    {
      id: "ShortPoolManagerProxy",
    }
  );
  const ShortPoolManager = m.contractAt("ShortPoolManager", ShortPoolManagerProxy);

  // deploy PoolManagerImplementation and upgrade
  const PoolManagerImplementation = m.contract(
    "PoolManager",
    [EthereumTokens.fxUSD.address, m.getParameter("FxUSDBasePoolProxy"), ShortPoolManager, PoolConfiguration],
    {
      id: "PoolManagerImplementation",
    }
  );
  /*const PoolManagerUpgrade = m.call(FxProxyAdmin, "upgrade", [PoolManager, PoolManagerImplementation], {
    id: "PoolManagerUpgrade",
  });
  */

  // deploy AaveFundingPoolImplementation and upgrade
  const WstETHLongPool = m.contractAt("AaveFundingPool", m.getParameter("WstETHLongPoolProxy"), {
    id: "WstETHLongPool",
  });
  const WBTCLongPool = m.contractAt("AaveFundingPool", m.getParameter("WBTCLongPoolProxy"), {
    id: "WBTCLongPool",
  });
  const AaveFundingPoolImplementation = m.contract("AaveFundingPool", [PoolManager, PoolConfiguration], {
    id: "AaveFundingPoolImplementation",
  });
  /*
  const WstETHLongPoolUpgrade = m.call(FxProxyAdmin, "upgrade", [WstETHLongPool, AaveFundingPoolImplementation], {
    id: "WstETHLongPoolUpgrade",
  });
  m.call(FxProxyAdmin, "upgrade", [WBTCLongPool, AaveFundingPoolImplementation], {
    id: "WBTCLongPoolUpgrade",
  });
  */

  // deploy InverseWstETHPriceOracle
  const InverseWstETHPriceOracle = m.contract(
    "InverseWstETHPriceOracle",
    [m.getParameter("StETHPriceOracle"), m.getParameter("RateProvider")],
    {
      id: "InverseWstETHPriceOracle",
    }
  );

  // deploy CreditNote for wstETH
  const CreditNoteImplementation = m.contract("CreditNote", [PoolManager], {
    id: "CreditNoteImplementation",
  });
  const CreditNoteInitializer = m.encodeFunctionCall(CreditNoteImplementation, "initialize", [
    "wstETH Credit Note",
    "wstETH-CN",
    18,
  ]);
  const CreditNoteProxy = m.contract(
    "TransparentUpgradeableProxy",
    [CreditNoteImplementation, FxProxyAdmin, CreditNoteInitializer],
    {
      id: "CreditNoteProxy",
    }
  );
  const CreditNote = m.contractAt("CreditNote", CreditNoteProxy);

  // deploy ShortPool for wstETH
  const ShortPoolImplementation = m.contract("ShortPool", [ShortPoolManager, PoolConfiguration], {
    id: "ShortPoolImplementation",
  });
  const ShortPoolInitializer = m.encodeFunctionCall(ShortPoolImplementation, "initialize", [
    admin,
    "f(x) stETH Short",
    "sstETH",
    InverseWstETHPriceOracle,
    EthereumTokens.wstETH.address,
    CreditNote,
  ]);
  const WstETHShortPoolProxy = m.contract(
    "TransparentUpgradeableProxy",
    [ShortPoolImplementation, FxProxyAdmin, ShortPoolInitializer],
    {
      id: "WstETHShortPoolProxy",
    }
  );
  const WstETHShortPool = m.contractAt("ShortPool", WstETHShortPoolProxy, { id: "WstETHShortPool" });

  // misc configuration
  m.call(FxUSDPriceOracle, "updateMaxPriceDeviation", [ethers.parseEther("0.002"), ethers.parseEther("0.001")]);

  // configuration for long pool
  // m.call(WstETHLongPool, "updateCounterparty", [WstETHShortPool], { after: [WstETHLongPoolUpgrade] });
  m.call(
    PoolConfiguration,
    "updatePoolFeeRatio",
    [WstETHLongPool, m.getParameter("Router"), 3000000n, 300000000000000000n, 1000000n, 0, 0],
    {
      id: "WstETHLongPoolFeeRatio",
    }
  );
  m.call(
    PoolConfiguration,
    "updatePoolFeeRatio",
    [WstETHLongPool, ZeroAddress, 3000000n, 300000000000000000n, 1000000n, 0, 0],
    {
      id: "WstETHLongPoolDefaultFeeRatio",
    }
  );
  m.call(
    PoolConfiguration,
    "updatePoolFeeRatio",
    [WBTCLongPool, m.getParameter("Router"), 3000000n, 300000000000000000n, 1000000n, 0, 0],
    {
      id: "WBTCLongPoolFeeRatio",
    }
  );
  m.call(
    PoolConfiguration,
    "updatePoolFeeRatio",
    [WBTCLongPool, ZeroAddress, 3000000n, 300000000000000000n, 1000000n, 0, 0],
    {
      id: "WBTCLongPoolDefaultFeeRatio",
    }
  );
  m.call(
    PoolConfiguration,
    "updateLongFundingRatioParameter",
    [WstETHLongPool, 1000000000000000000n, 10000000000000000000n, 950000000000000000n],
    {
      id: "WstETHLongPoolFundingRatioParameter",
    }
  );
  m.call(
    PoolConfiguration,
    "updateLongFundingRatioParameter",
    [WBTCLongPool, 1000000000000000000n, 10000000000000000000n, 950000000000000000n],
    {
      id: "WBTCLongPoolFundingRatioParameter",
    }
  );
  /*
  m.call(PoolManager, "updateShortBorrowCapacityRatio", [WstETHLongPool, ethers.parseEther("1")], {
    after: [PoolManagerUpgrade],
  });
  */

  // configuration for short pool
  m.call(
    PoolConfiguration,
    "updatePoolFeeRatio",
    [WstETHShortPool, m.getParameter("Router"), 3000000n, 300000000000000000n, 1000000n, 0, 0],
    {
      id: "WstETHShortPoolFeeRatio",
    }
  );
  m.call(
    PoolConfiguration,
    "updatePoolFeeRatio",
    [WstETHShortPool, ZeroAddress, 3000000n, 300000000000000000n, 1000000n, 0, 0],
    {
      id: "WstETHShortPoolDefaultFeeRatio",
    }
  );
  m.call(PoolConfiguration, "updateShortFundingRatioParameter", [
    WstETHShortPool,
    10000000000000000000n,
    450000000000000000n,
  ]);
  m.call(PoolConfiguration, "updateStableDepegPrice", [ethers.parseEther("0.995")]);
  m.call(ShortPoolManager, "registerPool", [
    WstETHShortPool,
    m.getParameter("GaugeRewarder"),
    ethers.parseEther("1000000000"),
    ethers.parseEther("1000000"),
    ethers.parseEther("0.0001"),
  ]);
  m.call(ShortPoolManager, "grantRole", [id("HARVESTER_ROLE"), KEEPER], {
    id: "ShortPoolManager_grant_HARVESTER_ROLE",
  });
  m.call(ShortPoolManager, "updateHarvesterRatio", [1000000n]);
  m.call(ShortPoolManager, "updateRedeemFeeRatio", [0n]);
  m.call(ShortPoolManager, "updateExpenseRatio", [0n, 0n, 100000000n]);
  m.call(ShortPoolManager, "updateRateProvider", [EthereumTokens.wstETH.address, ZeroAddress]);
  m.call(ShortPoolManager, "updateCloseRevenuePool", [m.getParameter("CloseRevenuePool")]);
  m.call(ShortPoolManager, "updateMiscRevenuePool", [m.getParameter("MiscRevenuePool")]);
  m.call(WstETHShortPool, "updateCounterparty", [WstETHLongPool]);
  m.call(WstETHShortPool, "updateDebtRatioRange", [90909090909090909n, 866666666666666666n]);
  m.call(WstETHShortPool, "updateRebalanceRatios", [ethers.parseEther("0.88"), ethers.parseUnits("0.025", 9)]);
  m.call(WstETHShortPool, "updateLiquidateRatios", [ethers.parseEther("0.95"), ethers.parseUnits("0.04", 9)]);

  // deploy ShortPositionOperateFlashLoanFacet
  const ShortPositionOperateFlashLoanFacet = m.contract("ShortPositionOperateFlashLoanFacet", [
    "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
    ShortPoolManager,
  ]);

  // deploy LongPositionEmergencyCloseFacet
  const LongPositionEmergencyCloseFacet = m.contract("LongPositionEmergencyCloseFacet", [
    "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
    PoolManager,
    ShortPoolManager,
    "0x12AF4529129303D7FbD2563E242C4a2890525912",
  ]);

  // upgrade facets
  /*const DiamondCutFacet = m.contractAt("DiamondCutFacet", m.getParameter("Router"));
  m.call(DiamondCutFacet, "diamondCut", [
    [
      {
        facetAddress: ShortPositionOperateFlashLoanFacet,
        action: 0,
        functionSelectors: getAllSignatures(ShortPositionOperateFlashLoanFacet__factory.createInterface()),
      },
      {
        facetAddress: LongPositionEmergencyCloseFacet,
        action: 0,
        functionSelectors: getAllSignatures(LongPositionEmergencyCloseFacet__factory.createInterface()),
      },
    ],
    ZeroAddress,
    "0x",
  ]);
  */

  // deploy DebtReducer and grant role
  const LongDebtReducer = m.contract("DebtReducer", [PoolManager], {
    id: "DebtReducer_Long",
  });
  // m.call(PoolManager, "grantRole", [id("DEBT_REDUCER_ROLE"), LongDebtReducer], { after: [PoolManagerUpgrade] });
  const ShortDebtReducer = m.contract("DebtReducer", [ShortPoolManager], {
    id: "DebtReducer_Short",
  });
  m.call(ShortPoolManager, "grantRole", [id("DEBT_REDUCER_ROLE"), ShortDebtReducer], {
    id: "ShortPoolManager_grant_DEBT_REDUCER_ROLE",
  });
  m.call(ReservePool, "grantRole", [id("POOL_MANAGER_ROLE"), PoolManager], {
    id: "ReservePool_grant_POOL_MANAGER_ROLE_PoolManager",
  });
  m.call(ReservePool, "grantRole", [id("POOL_MANAGER_ROLE"), ShortPoolManager], {
    id: "ReservePool_grant_POOL_MANAGER_ROLE_ShortPoolManager",
  });

  return {
    FxUSDPriceOracle,
    PoolConfiguration,
    ShortPoolManager,
    PoolManagerImplementation,
    AaveFundingPoolImplementation,

    LongDebtReducer,
    WstETHShortPool,
    WstETHLongPool,
    WBTCLongPool,

    ShortPositionOperateFlashLoanFacet,
    LongPositionEmergencyCloseFacet,
  };
});
