import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { StETHPriceOracle } from "@/types/index";

import { forkNetworkAndUnlockAccounts, mockETHBalance } from "@/test/utils";
import { Addresses } from "@/utils/address";
import {
  ChainlinkPriceFeed,
  encodeChainlinkPriceFeed,
  encodeSpotPriceSources,
  SpotPriceEncodings,
} from "@/utils/index";

const FORK_HEIGHT = 21204640;
const FORK_URL = process.env.MAINNET_FORK_RPC || "";
const DEPLOYER = "0x1000000000000000000000000000000000000001";

describe("StETHPriceOracle.spec", async () => {
  let deployer: HardhatEthersSigner;

  let oracle: StETHPriceOracle;

  beforeEach(async () => {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [DEPLOYER]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);

    const spot = await ethers.getContractAt("ISpotPriceOracle", "0xc2312CaF0De62eC9b4ADC785C79851Cb989C9abc", deployer);

    const StETHPriceOracle = await ethers.getContractFactory("StETHPriceOracle", deployer);
    oracle = await StETHPriceOracle.deploy(
      spot.getAddress(),
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["ETH-USD"].feed,
        ChainlinkPriceFeed.ethereum["ETH-USD"].scale,
        ChainlinkPriceFeed.ethereum["ETH-USD"].heartbeat
      ),
      Addresses["CRV_SP_ETH/stETH_303"]
    );

    await oracle.updateOnchainSpotEncodings(SpotPriceEncodings["WETH/USDC"], 0);
    await oracle.updateOnchainSpotEncodings(SpotPriceEncodings["stETH/WETH"], 1);
    await oracle.updateOnchainSpotEncodings(encodeSpotPriceSources([]), 2);
  });

  it("should succeed when normal", async () => {
    const ETH_USD_SpotPrices = await oracle.getETHUSDSpotPrices();
    console.log("ETH/USD:", ETH_USD_SpotPrices.map((x) => ethers.formatEther(x)).join(","));
    const stETH_ETH_SpotPrices = await oracle.getLSDETHSpotPrices();
    console.log("stETH/ETH:", stETH_ETH_SpotPrices.map((x) => ethers.formatEther(x)).join(","));
    const stETH_USD_SpotPrices = await oracle.getLSDUSDSpotPrices();
    expect(stETH_USD_SpotPrices.length).to.eq(0);
    const [ETHUSDChainlink, ETHUSDMinPrice, ETHUSDMaxPrice] = await oracle.getETHUSDSpotPrice();
    console.log(
      `ETHUSDChainlink[${ethers.formatEther(ETHUSDChainlink)}]`,
      `ETHUSDMinPrice[${ethers.formatEther(ETHUSDMinPrice)}]`,
      `ETHUSDMaxPrice[${ethers.formatEther(ETHUSDMaxPrice)}]`
    );

    const [anchorPrice, minPrice, maxPrice] = await oracle.getPrice();
    const gas = await oracle.getPrice.estimateGas();
    console.log(
      `anchorPrice[${ethers.formatEther(anchorPrice)}]`,
      `minPrice[${ethers.formatEther(minPrice)}]`,
      `maxPrice[${ethers.formatEther(maxPrice)}]`,
      `GasEstimated[${gas - 21000n}]`
    );
    console.log(`ExchangePrice:`, ethers.formatEther(await oracle.getExchangePrice()));
    console.log(`LiquidatePrice:`, ethers.formatEther(await oracle.getLiquidatePrice()));
    console.log(`RedeemPrice:`, ethers.formatEther(await oracle.getRedeemPrice()));
  });
});
