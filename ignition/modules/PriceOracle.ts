import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { Addresses, ChainlinkPriceFeed, encodeChainlinkPriceFeed } from "@/utils/index";

export default buildModule("PriceOracle", (m) => {
  // deploy StETHPriceOracle
  const StETHPriceOracle = m.contract("StETHPriceOracle", [
    m.getParameter("SpotPriceOracle"),
    encodeChainlinkPriceFeed(
      ChainlinkPriceFeed.ethereum["ETH-USD"].feed,
      ChainlinkPriceFeed.ethereum["ETH-USD"].scale,
      ChainlinkPriceFeed.ethereum["ETH-USD"].heartbeat
    ),
    Addresses["CRV_P_ETH/stETH_303"],
  ]);

  return {
    StETHPriceOracle,
  };
});
