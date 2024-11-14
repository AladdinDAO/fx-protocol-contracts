import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { encodeChainlinkPriceFeed } from "@/utils/codec";
import { ChainlinkPriceFeed } from "@/utils/oracle";
import { EthereumTokens } from "@/utils/tokens";

export default buildModule("PriceOracle", (m) => {
  // deploy StETHPriceOracle
  const StETHPriceOracle = m.contract("StETHPriceOracle", [
    m.getParameter("SpotPriceOracle"),
    "0x" +
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["ETH-USD"].feed,
        10n ** 10n,
        ChainlinkPriceFeed.ethereum["ETH-USD"].heartbeat
      )
        .toString(16)
        .padStart(64, "0"),
    EthereumTokens["CRV_P_ETH/stETH_303"].address,
  ]);

  return {
    StETHPriceOracle,
  };
});
