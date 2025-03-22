import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { forkNetworkAndUnlockAccounts, mockETHBalance } from "@/test/utils";
import { ETHPriceOracle } from "@/types/index";
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

describe("ETHPriceOracle", function () {
  let oracle: ETHPriceOracle;
  let deployer: HardhatEthersSigner;

  const CHAINLINK_ETH_USD_SPOT = encodeChainlinkPriceFeed(
    ChainlinkPriceFeed.base["ETH-USD"].feed,
    ChainlinkPriceFeed.base["ETH-USD"].scale,
    ChainlinkPriceFeed.base["ETH-USD"].heartbeat
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

    // Deploy ETHPriceOracle
    const ETHPriceOracle = await ethers.getContractFactory("ETHPriceOracle");
    oracle = await ETHPriceOracle.deploy(spot.getAddress(), CHAINLINK_ETH_USD_SPOT);
  });

  describe("constructor", function () {
    it("should initialize with correct values", async function () {
      expect(await oracle.Chainlink_ETH_USD_Spot()).to.equal(CHAINLINK_ETH_USD_SPOT);
      expect(await oracle.maxPriceDeviation()).to.equal(ethers.parseUnits("0.01", 18)); // 1%
    });
  });

  it("should succeed when normal", async () => {
    await oracle.updateOnchainSpotEncodings(BaseSpotPriceEncodings["WETH/USDC"]);

    const ETH_USD_SpotPrices = await oracle.getETHUSDSpotPrices();
    console.log("ETH/USD:", ETH_USD_SpotPrices.map((x) => ethers.formatEther(x)).join(","));
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
