import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

import { AaveFundingPool, MockERC20, MultiPathConverter, PositionAirdrop, ICurveStableSwapNG } from "@/types/index";

import { forkNetworkAndUnlockAccounts, mockETHBalance } from "@/test/utils";
import { EthereumTokens, MULTI_PATH_CONVERTER_ROUTES } from "@/utils/index";
import { AbiCoder, Contract, Interface, keccak256 } from "ethers";
import { expect } from "chai";

const FORK_HEIGHT = 22156940;
const FORK_URL = process.env.MAINNET_FORK_RPC || "";
const OWNER = "0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF";
const USDC_HOLDER = "0x8EB8a3b98659Cce290402893d0123abb75E3ab28";
const DEPLOYER = "0x1000000000000000000000000000000000000001";
const PRECISION = 10n ** 18n;
const slippage = 30n; // 0.3%

describe("PositionAirdrop.spec", async () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;

  let pool: AaveFundingPool;
  let converter: MultiPathConverter;

  let usdc: MockERC20;
  let curve: ICurveStableSwapNG;
  let airdrop: PositionAirdrop;

  beforeEach(async () => {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [DEPLOYER, OWNER, USDC_HOLDER]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    await mockETHBalance(OWNER, ethers.parseEther("100"));
    await mockETHBalance(USDC_HOLDER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);
    owner = await ethers.getSigner(OWNER);
    const holder = await ethers.getSigner(USDC_HOLDER);

    const PositionAirdrop = await ethers.getContractFactory("PositionAirdrop", deployer);
    airdrop = await PositionAirdrop.deploy(owner.address);

    usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, deployer);
    curve = await ethers.getContractAt("ICurveStableSwapNG", "0x5018be882dcce5e3f2f3b0913ae2096b9b3fb61f", deployer);
    converter = await ethers.getContractAt(
      "MultiPathConverter",
      "0x12AF4529129303D7FbD2563E242C4a2890525912",
      deployer
    );
    pool = await ethers.getContractAt("AaveFundingPool", "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8", deployer);

    await usdc.connect(holder).transfer(airdrop.getAddress(), ethers.parseUnits("30000", 6));
  });

  const encodeMiscData = (minDebtRatio: bigint, maxDebtRatio: bigint): bigint => {
    return (maxDebtRatio << 60n) + minDebtRatio;
  };

  const MulticallInterface = new Interface(
    JSON.parse(
      '[{"inputs":[{"components":[{"internalType":"address","name":"target","type":"address"},{"internalType":"bytes","name":"callData","type":"bytes"}],"internalType":"struct Multicall3.Call[]","name":"calls","type":"tuple[]"}],"name":"aggregate","outputs":[{"internalType":"uint256","name":"blockNumber","type":"uint256"},{"internalType":"bytes[]","name":"returnData","type":"bytes[]"}],"stateMutability":"payable","type":"function"},{"inputs":[{"components":[{"internalType":"address","name":"target","type":"address"},{"internalType":"bool","name":"allowFailure","type":"bool"},{"internalType":"bytes","name":"callData","type":"bytes"}],"internalType":"struct Multicall3.Call3[]","name":"calls","type":"tuple[]"}],"name":"aggregate3","outputs":[{"components":[{"internalType":"bool","name":"success","type":"bool"},{"internalType":"bytes","name":"returnData","type":"bytes"}],"internalType":"struct Multicall3.Result[]","name":"returnData","type":"tuple[]"}],"stateMutability":"payable","type":"function"},{"inputs":[{"components":[{"internalType":"address","name":"target","type":"address"},{"internalType":"bool","name":"allowFailure","type":"bool"},{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"bytes","name":"callData","type":"bytes"}],"internalType":"struct Multicall3.Call3Value[]","name":"calls","type":"tuple[]"}],"name":"aggregate3Value","outputs":[{"components":[{"internalType":"bool","name":"success","type":"bool"},{"internalType":"bytes","name":"returnData","type":"bytes"}],"internalType":"struct Multicall3.Result[]","name":"returnData","type":"tuple[]"}],"stateMutability":"payable","type":"function"},{"inputs":[{"components":[{"internalType":"address","name":"target","type":"address"},{"internalType":"bytes","name":"callData","type":"bytes"}],"internalType":"struct Multicall3.Call[]","name":"calls","type":"tuple[]"}],"name":"blockAndAggregate","outputs":[{"internalType":"uint256","name":"blockNumber","type":"uint256"},{"internalType":"bytes32","name":"blockHash","type":"bytes32"},{"components":[{"internalType":"bool","name":"success","type":"bool"},{"internalType":"bytes","name":"returnData","type":"bytes"}],"internalType":"struct Multicall3.Result[]","name":"returnData","type":"tuple[]"}],"stateMutability":"payable","type":"function"},{"inputs":[],"name":"getBasefee","outputs":[{"internalType":"uint256","name":"basefee","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"blockNumber","type":"uint256"}],"name":"getBlockHash","outputs":[{"internalType":"bytes32","name":"blockHash","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getBlockNumber","outputs":[{"internalType":"uint256","name":"blockNumber","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getChainId","outputs":[{"internalType":"uint256","name":"chainid","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getCurrentBlockCoinbase","outputs":[{"internalType":"address","name":"coinbase","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getCurrentBlockDifficulty","outputs":[{"internalType":"uint256","name":"difficulty","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getCurrentBlockGasLimit","outputs":[{"internalType":"uint256","name":"gaslimit","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getCurrentBlockTimestamp","outputs":[{"internalType":"uint256","name":"timestamp","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"addr","type":"address"}],"name":"getEthBalance","outputs":[{"internalType":"uint256","name":"balance","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getLastBlockHash","outputs":[{"internalType":"bytes32","name":"blockHash","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bool","name":"requireSuccess","type":"bool"},{"components":[{"internalType":"address","name":"target","type":"address"},{"internalType":"bytes","name":"callData","type":"bytes"}],"internalType":"struct Multicall3.Call[]","name":"calls","type":"tuple[]"}],"name":"tryAggregate","outputs":[{"components":[{"internalType":"bool","name":"success","type":"bool"},{"internalType":"bytes","name":"returnData","type":"bytes"}],"internalType":"struct Multicall3.Result[]","name":"returnData","type":"tuple[]"}],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"bool","name":"requireSuccess","type":"bool"},{"components":[{"internalType":"address","name":"target","type":"address"},{"internalType":"bytes","name":"callData","type":"bytes"}],"internalType":"struct Multicall3.Call[]","name":"calls","type":"tuple[]"}],"name":"tryBlockAndAggregate","outputs":[{"internalType":"uint256","name":"blockNumber","type":"uint256"},{"internalType":"bytes32","name":"blockHash","type":"bytes32"},{"components":[{"internalType":"bool","name":"success","type":"bool"},{"internalType":"bytes","name":"returnData","type":"bytes"}],"internalType":"struct Multicall3.Result[]","name":"returnData","type":"tuple[]"}],"stateMutability":"payable","type":"function"}]'
    )
  );

  const searchAmount = async (
    left: bigint,
    right: bigint,
    expect: bigint,
    routes: {
      encoding: bigint;
      routes: Array<bigint>;
    },
    precision: bigint
  ): Promise<[number, bigint]> => {
    const multicall = new Contract("0xcA11bde05977b3631167028862bE2a173976CA11", MulticallInterface, ethers.provider);
    let times = 0;
    while (left + precision < right) {
      const calls: Array<{ target: string; callData: string }> = [];
      const step = (right - left) / 100n;
      for (let i = 0; i < 100; ++i) {
        const amount = left + step * BigInt(i + 1);
        calls.push({
          target: await converter.getAddress(),
          callData: converter.interface.encodeFunctionData("queryConvert", [amount, routes.encoding, routes.routes]),
        });
      }
      times += 1;
      const [, results] = await multicall.aggregate.staticCall(calls);
      for (let i = 0; i < 100; ++i) {
        const output = BigInt(results[i]);
        if (output >= expect) {
          left += step * BigInt(i);
          right = left + step;
          break;
        }
      }
    }
    return [times, right];
  };

  // assume all fxUSD will sell to wstETH
  const claim = async (amountIn: bigint, leverage: bigint) => {
    const rateProvider = await ethers.getContractAt(
      "IRateProvider",
      "0x81A777c4aB65229d1Bf64DaE4c831bDf628Ccc7f",
      deployer
    );
    const oracle = await ethers.getContractAt(
      "StETHPriceOracle",
      "0x0C5C61025f047cB7e3e85852dC8eAFd7b9a4Abfb",
      deployer
    );
    const routeUSDCToWstETH = MULTI_PATH_CONVERTER_ROUTES.USDC.wstETH;
    const routeFxUSDToWstETH = MULTI_PATH_CONVERTER_ROUTES.fxUSD.wstETH;

    const wstETHAmountIn = await converter.queryConvert.staticCall(
      amountIn,
      routeUSDCToWstETH.encoding,
      routeUSDCToWstETH.routes
    );
    // in this case currentColls = currentDebts = 0
    // borrow wstETH is x, new mint fxUSD is y, and we have
    // (wstETHAmountIn + x) * rate * minPrice * (1 - 1 / l) = y
    // x * rate * minPrice = y
    // we get
    // ((wstETHAmountIn + x) * rate) * minPrice * (1 - 1 / l) = x * rate * minPrice
    // (wstETHAmountIn * rate + x * rate) * minPrice * (1 - 1 / l) = x * rate * minPrice
    // (wstETHAmountIn * rate) * minPrice * (1 - 1 / l) + x * rate * minPrice * (1 - 1 / l) = x * rate * minPrice
    // (wstETHAmountIn * rate) * minPrice * (1 - 1 / l) = x * rate * minPrice / l
    // x = (wstETHAmountIn * rate) * minPrice * (l - 1) / rate / minPrice
    // y = (wstETHAmountIn * rate) * minPrice * (l - 1)
    const rate = await rateProvider.getRate();
    const [anchorPrice, minPrice] = await oracle.getPrice();
    const hintFxUSDAmount = (((wstETHAmountIn * rate) / PRECISION) * minPrice * (leverage - 1n)) / PRECISION;
    if (hintFxUSDAmount <= 0n) throw Error("cannot open or add to given leverage");
    const borrowAmount = (hintFxUSDAmount * PRECISION * PRECISION) / rate / minPrice;
    // binary search to fxUSD to borrow, precision 1 fxUSD
    let [searchTimes, fxUSDAmount] = await searchAmount(
      hintFxUSDAmount,
      hintFxUSDAmount * 2n,
      borrowAmount,
      routeFxUSDToWstETH,
      PRECISION
    );
    // add slippage
    fxUSDAmount = (fxUSDAmount * (10000n + slippage)) / 10000n;
    const targetDebtRatio =
      (fxUSDAmount * PRECISION * PRECISION * PRECISION) / ((borrowAmount + wstETHAmountIn) * rate * anchorPrice);
    console.log(
      `SearchTimes[${searchTimes}]`,
      `USDC Supplied[${ethers.formatUnits(amountIn, 6)}]`,
      `wstETHToSupply[${ethers.formatEther(wstETHAmountIn)}]`,
      `wstETHToBorrow[${ethers.formatEther(borrowAmount)}]`,
      `fxUSDToMint[${ethers.formatEther(fxUSDAmount)}]`,
      `TargetDebtRatio[${ethers.formatEther(targetDebtRatio)}]`
    );

    const params = {
      tokenIn: await usdc.getAddress(),
      amount: amountIn,
      target: await converter.getAddress(),
      data: converter.interface.encodeFunctionData("convert", [
        await usdc.getAddress(),
        amountIn,
        routeUSDCToWstETH.encoding,
        routeUSDCToWstETH.routes,
      ]),
      minOut: 0n,
      signature: "0x",
    };

    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "address", "bytes"],
      [
        encodeMiscData((targetDebtRatio * 99n) / 100n, (targetDebtRatio * 101n) / 100n), // 1% slippage
        fxUSDAmount,
        await converter.getAddress(),
        converter.interface.encodeFunctionData("convert", [
          EthereumTokens.fxUSD.address,
          fxUSDAmount,
          routeFxUSDToWstETH.encoding,
          routeFxUSDToWstETH.routes,
        ]),
      ]
    );

    expect(await pool.balanceOf(deployer.address)).to.equal(0n);
    await airdrop.connect(deployer).claim(0, amountIn, [], params, await pool.getAddress(), borrowAmount, data);
    expect(await pool.balanceOf(deployer.address)).to.equal(1n);
  };

  const Amount = ethers.parseUnits("1000", 6);
  it("should claim with 2x leverage", async () => {
    const root = keccak256(
      AbiCoder.defaultAbiCoder().encode(["uint256", "address", "uint256"], [0, deployer.address, Amount])
    );
    await airdrop.connect(owner).updateMerkleRoot(root);

    await claim(Amount, 2n);
  });

  it("should claim with 3x leverage", async () => {
    const root = keccak256(
      AbiCoder.defaultAbiCoder().encode(["uint256", "address", "uint256"], [0, deployer.address, Amount])
    );
    await airdrop.connect(owner).updateMerkleRoot(root);

    await claim(Amount, 3n);
  });

  it("should claim with 4x leverage", async () => {
    const root = keccak256(
      AbiCoder.defaultAbiCoder().encode(["uint256", "address", "uint256"], [0, deployer.address, Amount])
    );
    await airdrop.connect(owner).updateMerkleRoot(root);

    await claim(Amount, 4n);
  });
});
