import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { ChainlinkPriceFeed, encodeChainlinkPriceFeed, EthereumTokens } from "@/utils/index";
import { ethers } from "ethers";

export default buildModule("Upgrade20250318", (m) => {
  // deploy PoolManager implementation
  const PoolManagerImplementation = m.contract(
    "PoolManager",
    [m.getParameter("FxUSDProxy"), m.getParameter("FxUSDBasePoolProxy"), m.getParameter("PegKeeperProxy")],
    {
      id: "PoolManagerImplementation",
    }
  );

  // deploy AaveFundingPool implementation
  const AaveFundingPoolImplementation = m.contract(
    "AaveFundingPool",
    [m.getParameter("PoolManagerProxy"), m.getParameter("LendingPool"), m.getParameter("BaseAsset")],
    { id: "AaveFundingPoolImplementation" }
  );

  // deploy FxUSDBasePool implementation
  const FxUSDBasePoolImplementation = m.contract(
    "FxUSDBasePool",
    [
      m.getParameter("PoolManagerProxy"),
      m.getParameter("PegKeeperProxy"),
      m.getParameter("FxUSDProxy"),
      EthereumTokens.USDC.address,
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["USDC-USD"].feed,
        ChainlinkPriceFeed.ethereum["USDC-USD"].scale,
        ChainlinkPriceFeed.ethereum["USDC-USD"].heartbeat
      ),
    ],
    { id: "FxUSDBasePoolImplementation" }
  );

  // deploy PositionOperateFlashLoanFacetV2
  const PositionOperateFlashLoanFacetV2 = m.contract("PositionOperateFlashLoanFacetV2", [
    "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
    m.getParameter("PoolManagerProxy"),
  ]);

  // deploy MorphoFlashLoanCallbackFacet
  const MorphoFlashLoanCallbackFacet = m.contract("MorphoFlashLoanCallbackFacet", [
    "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
  ]);

  // deploy FxUSDBasePoolV2Facet
  const FxUSDBasePoolV2Facet = m.contract("FxUSDBasePoolV2Facet", [m.getParameter("FxUSDBasePoolProxy")]);

  // deploy RevenuePool
  const CloseRevenuePool = m.contract(
    "RevenuePool",
    [m.getParameter("Treasury"), m.getParameter("Treasury"), "0x11E91BB6d1334585AA37D8F4fde3932C7960B938"],
    {
      id: "CloseRevenuePool",
    }
  );
  const MiscRevenuePool = m.contract(
    "RevenuePool",
    [m.getParameter("Treasury"), m.getParameter("Treasury"), "0x11E91BB6d1334585AA37D8F4fde3932C7960B938"],
    {
      id: "MiscRevenuePool",
    }
  );

  // add reward token to MiscRevenuePool and CloseRevenuePool
  m.call(
    CloseRevenuePool,
    "addRewardToken",
    [
      EthereumTokens.wstETH.address,
      m.getParameter("GaugeRewarder"),
      0n,
      ethers.parseUnits("0.3", 9),
      ethers.parseUnits("0.7", 9),
    ],
    { id: "CloseRevenuePool_addRewardToken_wstETH" }
  );
  m.call(
    CloseRevenuePool,
    "addRewardToken",
    [
      EthereumTokens.WBTC.address,
      m.getParameter("GaugeRewarder"),
      0n,
      ethers.parseUnits("0.3", 9),
      ethers.parseUnits("0.7", 9),
    ],
    { id: "CloseRevenuePool_addRewardToken_WBTC" }
  );
  m.call(
    MiscRevenuePool,
    "addRewardToken",
    [
      EthereumTokens.wstETH.address,
      m.getParameter("GaugeRewarder"),
      0n,
      ethers.parseUnits("0.3", 9),
      ethers.parseUnits("0.7", 9),
    ],
    { id: "MiscRevenuePool_addRewardToken_wstETH" }
  );
  m.call(
    MiscRevenuePool,
    "addRewardToken",
    [
      EthereumTokens.WBTC.address,
      m.getParameter("GaugeRewarder"),
      0n,
      ethers.parseUnits("0.3", 9),
      ethers.parseUnits("0.7", 9),
    ],
    { id: "MiscRevenuePool_addRewardToken_WBTC" }
  );

  return {
    PositionOperateFlashLoanFacetV2,
    MorphoFlashLoanCallbackFacet,
    FxUSDBasePoolV2Facet,
    PoolManagerImplementation,
    AaveFundingPoolImplementation,
    FxUSDBasePoolImplementation,

    CloseRevenuePool,
    MiscRevenuePool,

    Router: m.contractAt("Diamond", m.getParameter("Router")),
    FxUSDProxy: m.contractAt("FxUSDRegeneracy", m.getParameter("FxUSDProxy")),
    FxUSDBasePoolProxy: m.contractAt("FxUSDBasePool", m.getParameter("FxUSDBasePoolProxy")),
    PoolManagerProxy: m.contractAt("PoolManager", m.getParameter("PoolManagerProxy")),
    GaugeRewarder: m.contractAt("GaugeRewarder", m.getParameter("GaugeRewarder")),
  };
});
