import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { Addresses, ChainlinkPriceFeed, encodeChainlinkPriceFeed, SpotPriceEncodings } from "@/utils/index";

export default buildModule("PriceOracle", (m) => {
  // deploy ETHPriceOracle
  const ETHPriceOracle = m.contract("ETHPriceOracle", [
    m.getParameter("SpotPriceOracle"),
    encodeChainlinkPriceFeed(
      ChainlinkPriceFeed.katana["ETH-USD"].feed,
      ChainlinkPriceFeed.katana["ETH-USD"].scale,
      ChainlinkPriceFeed.katana["ETH-USD"].heartbeat,
    ),
  ]);
  m.call(ETHPriceOracle, "updateOnchainSpotEncodings", [SpotPriceEncodings["ETH/USDC"]], {
    id: "ETH_onchainSpotEncodings_ETHUSD",
  });
  m.call(ETHPriceOracle, "updateMaxPriceDeviation", [2n * 10n ** 16n]); // 2%

  // deploy WBTCPriceOracle
  const WBTCPriceOracle = m.contract("WBTCPriceOracle", [
    m.getParameter("SpotPriceOracle"),
    encodeChainlinkPriceFeed(
      ChainlinkPriceFeed.katana["BTC-USD"].feed,
      ChainlinkPriceFeed.katana["BTC-USD"].scale,
      ChainlinkPriceFeed.katana["BTC-USD"].heartbeat,
    ),
    encodeChainlinkPriceFeed(
      ChainlinkPriceFeed.katana["WBTC-BTC"].feed,
      ChainlinkPriceFeed.katana["WBTC-BTC"].scale,
      ChainlinkPriceFeed.katana["WBTC-BTC"].heartbeat,
    ),
  ]);
  m.call(WBTCPriceOracle, "updateOnchainSpotEncodings", [SpotPriceEncodings["WBTC/USDC"]]);
  m.call(WBTCPriceOracle, "updateMaxPriceDeviation", [2n * 10n ** 16n]); // 2%

  return {
    ETHPriceOracle,
    WBTCPriceOracle,
  };
});
