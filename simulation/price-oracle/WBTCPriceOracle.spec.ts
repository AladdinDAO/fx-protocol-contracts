import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

import { WBTCPriceOracle } from "@/types/index";

import { forkNetworkAndUnlockAccounts, mockETHBalance } from "@/test/utils";
import { ChainlinkPriceFeed, encodeChainlinkPriceFeed, SpotPriceEncodings } from "@/utils/index";

const FORK_HEIGHT = 21204640;
const FORK_URL = process.env.MAINNET_FORK_RPC || "";
const DEPLOYER = "0x1000000000000000000000000000000000000001";

describe("WBTCPriceOracle.spec", async () => {
  let deployer: HardhatEthersSigner;

  let oracle: WBTCPriceOracle;

  beforeEach(async () => {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [DEPLOYER]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);

    const spot = await ethers.getContractAt("ISpotPriceOracle", "0xc2312CaF0De62eC9b4ADC785C79851Cb989C9abc", deployer);

    const WBTCPriceOracle = await ethers.getContractFactory("WBTCPriceOracle", deployer);
    oracle = await WBTCPriceOracle.deploy(
      spot.getAddress(),
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["BTC-USD"].feed,
        ChainlinkPriceFeed.ethereum["BTC-USD"].scale,
        ChainlinkPriceFeed.ethereum["BTC-USD"].heartbeat
      ),
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["WBTC-BTC"].feed,
        ChainlinkPriceFeed.ethereum["WBTC-BTC"].scale,
        ChainlinkPriceFeed.ethereum["WBTC-BTC"].heartbeat
      )
    );

    await oracle.updateOnchainSpotEncodings(SpotPriceEncodings["WBTC/USDC"]);
  });

  it("should succeed when normal", async () => {
    const WBTC_USD_SpotPrices = await oracle.getBTCDerivativeUSDSpotPrices();
    console.log("WBTC/USD:", WBTC_USD_SpotPrices.map((x) => ethers.formatEther(x)).join(","));
    const WBTCUSDChainlink = await oracle.getBTCDerivativeUSDAnchorPrice(false);
    console.log(`WBTCUSDChainlink[${ethers.formatEther(WBTCUSDChainlink)}]`);

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
