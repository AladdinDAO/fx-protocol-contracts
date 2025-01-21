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

  // deploy ETHPriceOracle
  const ETHPriceOracle = m.contract("ETHPriceOracle", [
    m.getParameter("SpotPriceOracle"),
    encodeChainlinkPriceFeed(
      ChainlinkPriceFeed.ethereum["ETH-USD"].feed,
      ChainlinkPriceFeed.ethereum["ETH-USD"].scale,
      ChainlinkPriceFeed.ethereum["ETH-USD"].heartbeat
    ),
  ]);
  m.call(ETHPriceOracle, "updateOnchainSpotEncodings", [SpotPriceEncodings["WETH/USDC"]]);

  // deploy WBTCPriceOracle
  const WBTCPriceOracle = m.contract("WBTCPriceOracle", [
    m.getParameter("SpotPriceOracle"),
    encodeChainlinkPriceFeed(
      ChainlinkPriceFeed.ethereum["BTC-USD"].feed,
      ChainlinkPriceFeed.ethereum["BTC-USD"].scale,
      ChainlinkPriceFeed.ethereum["BTC-USD"].heartbeat
    ),
    encodeChainlinkPriceFeed(
      ChainlinkPriceFeed.ethereum["WBTC-BTC"].feed,
      ChainlinkPriceFeed.ethereum["WBTC-BTC"].scale,
      ChainlinkPriceFeed.ethereum["WBTC-BTC"].heartbeat
    ),
  ]);
  m.call(WBTCPriceOracle, "updateOnchainSpotEncodings", [SpotPriceEncodings["WBTC/USDC"]]);

  return {
    StETHPriceOracle,
    ETHPriceOracle,
    WBTCPriceOracle,
  };
});
