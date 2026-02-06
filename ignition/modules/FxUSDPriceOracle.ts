import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers, ZeroAddress } from "ethers";

import { Addresses, ChainlinkPriceFeed, encodeChainlinkPriceFeed } from "@/utils/index";

import EmptyContractModule from "./EmptyContract";
import ProxyAdminModule from "./ProxyAdmin";
import ProxiesModule from "./Proxies";

export default buildModule("FxUSDPriceOracle", (m) => {
  const admin = m.getAccount(0);
  const { fx: FxProxyAdmin } = m.useModule(ProxyAdminModule);
  const { EmptyContract } = m.useModule(EmptyContractModule);
  const { FxUSDProxy } = m.useModule(ProxiesModule);

  // deploy FxUSDPriceOracle
  const FxUSDPriceOracleImplementation = m.contract(
    "FxUSDPriceOracle",
    [
      FxUSDProxy,
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.katana["USDC-USD"].feed,
        ChainlinkPriceFeed.katana["USDC-USD"].scale,
        ChainlinkPriceFeed.katana["USDC-USD"].heartbeat,
      ),
    ],
    {
      id: "FxUSDPriceOraclelementation",
    },
  );
  const FxUSDPriceOracleInitializer = m.encodeFunctionCall(FxUSDPriceOracleImplementation, "initialize", [
    admin,
    m.getParameter("SushiPool"),
    m.getParameter("secondsAgo"),
    m.getParameter("minLiquidity"),
  ]);
  const FxUSDPriceOracleProxy = m.contract(
    "TransparentUpgradeableProxy",
    [FxUSDPriceOracleImplementation, FxProxyAdmin, FxUSDPriceOracleInitializer],
    {
      id: "FxUSDPriceOracleProxy",
    },
  );
  const FxUSDPriceOracle = m.contractAt("FxUSDPriceOracle", FxUSDPriceOracleProxy);
  m.call(FxUSDPriceOracle, "updateMaxPriceDeviation", [ethers.parseEther("0.002"), ethers.parseEther("0.001")]);

  return {
    FxUSDProxy,
    FxUSDPriceOracle,
  };
});
