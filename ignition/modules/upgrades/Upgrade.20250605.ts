import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { ChainlinkPriceFeed, encodeChainlinkPriceFeed, EthereumTokens, SpotPriceEncodings } from "@/utils/index";

export default buildModule("Upgrade20250605", (m) => {
  const admin = m.getAccount(0);

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

  // deploy PegKeeper implementation
  const PegKeeperImplementation = m.contract("PegKeeper", [m.getParameter("FxUSDBasePoolProxy")], {
    id: "PegKeeperImplementation",
  });

  // deploy AaveV3CompoundStrategy
  const AaveV3CompoundStrategy = m.contract("AaveV3CompoundStrategy", [
    admin,
    m.getParameter("FxUSDBasePoolProxy"),
    "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    EthereumTokens.USDC.address,
    "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c",
  ]);


  const StETHPriceOracle = m.contractAt("StETHPriceOracle", "0x3716352d57C2e48EEdB56Ee0712Ef29E0c2f3069");
  m.call(StETHPriceOracle, "updateOnchainSpotEncodings", [SpotPriceEncodings["WETH/USDC"], 0], {
    id: "StETH_onchainSpotEncodings_ETHUSD",
  });

  return {
    PoolManagerImplementation,
    AaveFundingPoolImplementation,
    FxUSDBasePoolImplementation,
    PegKeeperImplementation,
    AaveV3CompoundStrategy,
  };
});
