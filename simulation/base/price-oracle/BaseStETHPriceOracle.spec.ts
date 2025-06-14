import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { forkNetworkAndUnlockAccounts, mockETHBalance } from "@/test/utils";
import { BaseStETHPriceOracle } from "@/types/index";
import {
  BaseSpotPriceEncodings,
  ChainlinkPriceFeed,
  encodeChainlinkPriceFeed,
  encodeSpotPriceSources,
} from "@/utils/index";

const FORK_HEIGHT = 27931870;
const FORK_URL = process.env.BASE_FORK_RPC || "";
const DEPLOYER = "0x1000000000000000000000000000000000000001";
const OWNER = "0xa1dBA4A3d4e35E41895cFF3044cD6f37B38DB240";

describe("BaseStETHPriceOracle", function () {
  let oracle: BaseStETHPriceOracle;
  let deployer: HardhatEthersSigner;

  const CHAINLINK_ETH_USD_SPOT = encodeChainlinkPriceFeed(
    ChainlinkPriceFeed.base["ETH-USD"].feed,
    ChainlinkPriceFeed.base["ETH-USD"].scale,
    ChainlinkPriceFeed.base["ETH-USD"].heartbeat
  );

  const CHAINLINK_wstETH_ETH_SPOT = encodeChainlinkPriceFeed(
    ChainlinkPriceFeed.base["wstETH-ETH"].feed,
    ChainlinkPriceFeed.base["wstETH-ETH"].scale,
    ChainlinkPriceFeed.base["wstETH-ETH"].heartbeat
  );

  const CHAINLINK_wstETH_stETH_SPOT = encodeChainlinkPriceFeed(
    ChainlinkPriceFeed.base["wstETH-stETH"].feed,
    ChainlinkPriceFeed.base["wstETH-stETH"].scale,
    ChainlinkPriceFeed.base["wstETH-stETH"].heartbeat
  );

  beforeEach(async function () {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [DEPLOYER, OWNER]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    await mockETHBalance(OWNER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);
    const owner = await ethers.getSigner(OWNER);

    const spot = await ethers.getContractAt(
      "ISpotPriceOracleOwnable",
      "0xF89Bdf582112424D3Af9e373139B69e546B6c7E2",
      owner
    );

    // Deploy AerodromeSpotPriceReader
    const AerodromeSpotPriceReader = await ethers.getContractFactory("AerodromeSpotPriceReader");
    const aerodromeSpotPriceReader = await AerodromeSpotPriceReader.deploy();

    await spot.updateReader(12, aerodromeSpotPriceReader.getAddress());

    // Deploy BaseStETHPriceOracle
    const BaseStETHPriceOracle = await ethers.getContractFactory("BaseStETHPriceOracle");
    oracle = await BaseStETHPriceOracle.deploy(
      spot.getAddress(),
      CHAINLINK_ETH_USD_SPOT,
      CHAINLINK_wstETH_ETH_SPOT,
      CHAINLINK_wstETH_stETH_SPOT
    );
  });

  describe("constructor", function () {
    it("should initialize with correct values", async function () {
      expect(await oracle.Chainlink_ETH_USD_Spot()).to.equal(CHAINLINK_ETH_USD_SPOT);
      expect(await oracle.Chainlink_wstETH_ETH_Spot()).to.equal(CHAINLINK_wstETH_ETH_SPOT);
      expect(await oracle.Chainlink_wstETH_stETH_Spot()).to.equal(CHAINLINK_wstETH_stETH_SPOT);
      expect(await oracle.maxPriceDeviation()).to.equal(ethers.parseUnits("0.01", 18)); // 1%
    });
  });

  it("should succeed when normal", async () => {
    await oracle.updateOnchainSpotEncodings(BaseSpotPriceEncodings["WETH/USDC"], 0);
    await oracle.updateOnchainSpotEncodings(BaseSpotPriceEncodings["wstETH/ETH"], 1);
    await oracle.updateOnchainSpotEncodings(encodeSpotPriceSources([]), 2);

    const wstETH_USD_SpotPrices = await oracle.getWstETHUSDSpotPrices();
    console.log("wstETH/USD:", wstETH_USD_SpotPrices.map((x) => ethers.formatEther(x)).join(","));
    const wstETH_ETH_SpotPrices = await oracle.getWstETHETHSpotPrices();
    console.log("wstETH/ETH:", wstETH_ETH_SpotPrices.map((x) => ethers.formatEther(x)).join(","));
    const [wstETHUSDChainlink, wstETHUSDMinPrice, wstETHUSDMaxPrice] = await oracle.getWstETHUSDSpotPrice();
    console.log(
      `wstETHUSDChainlink[${ethers.formatEther(wstETHUSDChainlink)}]`,
      `wstETHUSDMinPrice[${ethers.formatEther(wstETHUSDMinPrice)}]`,
      `wstETHUSDMaxPrice[${ethers.formatEther(wstETHUSDMaxPrice)}]`
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
