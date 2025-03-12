import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { Addresses, ChainlinkPriceFeed, encodeChainlinkPriceFeed, SpotPriceEncodings } from "@/utils/index";

export default buildModule("PriceOracle", (m) => {
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

  return {
    StETHPriceOracle
  };
});
