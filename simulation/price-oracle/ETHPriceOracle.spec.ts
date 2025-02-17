import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

import { ETHPriceOracle } from "@/types/index";

import { forkNetworkAndUnlockAccounts, mockETHBalance } from "@/test/utils";
import { ChainlinkPriceFeed, encodeChainlinkPriceFeed, SpotPriceEncodings } from "@/utils/index";

const FORK_HEIGHT = 21204640;
const FORK_URL = process.env.MAINNET_FORK_RPC || "";
const DEPLOYER = "0x1000000000000000000000000000000000000001";

describe("ETHPriceOracle.spec", async () => {
  let deployer: HardhatEthersSigner;

  let oracle: ETHPriceOracle;

  beforeEach(async () => {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [DEPLOYER]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);

    const spot = await ethers.getContractAt("ISpotPriceOracle", "0xc2312CaF0De62eC9b4ADC785C79851Cb989C9abc", deployer);

    const ETHPriceOracle = await ethers.getContractFactory("ETHPriceOracle", deployer);
    oracle = await ETHPriceOracle.deploy(
      spot.getAddress(),
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["ETH-USD"].feed,
        ChainlinkPriceFeed.ethereum["ETH-USD"].scale,
        ChainlinkPriceFeed.ethereum["ETH-USD"].heartbeat
      )
    );

    await oracle.updateOnchainSpotEncodings(SpotPriceEncodings["WETH/USDC"]);
  });

  it("should succeed when normal", async () => {
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
