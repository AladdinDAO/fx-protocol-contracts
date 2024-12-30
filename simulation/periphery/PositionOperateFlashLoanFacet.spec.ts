import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

import {
  AaveFundingPool,
  Diamond,
  FxUSDRegeneracy,
  FxUSDBasePool,
  FxUSDBasePool__factory,
  MockERC20,
  MultiPathConverter,
  PegKeeper,
  PegKeeper__factory,
  PoolManager,
  PoolManager__factory,
  ProxyAdmin,
  ReservePool,
  GaugeRewarder,
  StETHPriceOracle,
  DiamondCutFacet__factory,
  DiamondLoupeFacet__factory,
  OwnershipFacet__factory,
  RouterManagementFacet__factory,
  FlashLoanCallbackFacet__factory,
  PositionOperateFlashLoanFacet__factory,
  MigrateFacet__factory,
  IRateProvider,
} from "@/types/index";

import { forkNetworkAndUnlockAccounts, mockETHBalance, unlockAccounts } from "@/test/utils";
import { Addresses } from "@/utils/address";
import {
  ChainlinkPriceFeed,
  encodeChainlinkPriceFeed,
  encodeSpotPriceSources,
  EthereumTokens,
  MULTI_PATH_CONVERTER_ROUTES,
  same,
  SpotPriceEncodings,
} from "@/utils/index";
import { Contract, id, Interface, ZeroAddress } from "ethers";

const FORK_HEIGHT = 21234850;
const FORK_URL = process.env.MAINNET_FORK_RPC || "";
const PLATFORM = "0x0084C2e1B1823564e597Ff4848a88D61ac63D703";
const OWNER = "0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF";
const DEPLOYER = "0x1000000000000000000000000000000000000001";
const PRECISION = 10n ** 18n;

const getAllSignatures = (e: Interface): string[] => {
  const sigs: string[] = [];
  e.forEachFunction((func, _) => {
    sigs.push(func.selector);
  });
  return sigs;
};

describe("PositionOperateFlashLoanFacet.spec", async () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;

  let proxyAdmin: ProxyAdmin;

  let fxUSD: FxUSDRegeneracy;
  let usdc: MockERC20;
  let wstETH: MockERC20;

  let oracle: StETHPriceOracle;
  let rateProvider: IRateProvider;

  let pegKeeper: PegKeeper;
  let poolManager: PoolManager;
  let reservePool: ReservePool;
  let fxBASE: FxUSDBasePool;
  let rewarder: GaugeRewarder;
  let pool: AaveFundingPool;

  let converter: MultiPathConverter;
  let router: Diamond;

  beforeEach(async () => {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [DEPLOYER, OWNER]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    await mockETHBalance(OWNER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);
    owner = await ethers.getSigner(OWNER);

    const spot = await ethers.getContractAt("ISpotPriceOracle", "0xc2312CaF0De62eC9b4ADC785C79851Cb989C9abc", deployer);
    proxyAdmin = await ethers.getContractAt("ProxyAdmin", "0x9B54B7703551D9d0ced177A78367560a8B2eDDA4", owner);

    rateProvider = await ethers.getContractAt("IRateProvider", "0x81A777c4aB65229d1Bf64DaE4c831bDf628Ccc7f", deployer);
    fxUSD = await ethers.getContractAt("FxUSDRegeneracy", EthereumTokens.fxUSD.address, deployer);
    usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, deployer);
    wstETH = await ethers.getContractAt("MockERC20", EthereumTokens.wstETH.address, deployer);

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

    const EmptyContract = await ethers.getContractFactory("EmptyContract", deployer);
    const TransparentUpgradeableProxy = await ethers.getContractFactory("TransparentUpgradeableProxy", deployer);
    const FxUSDRegeneracy = await ethers.getContractFactory("FxUSDRegeneracy", deployer);
    const PegKeeper = await ethers.getContractFactory("PegKeeper", deployer);
    const PoolManager = await ethers.getContractFactory("PoolManager", deployer);
    const FxUSDBasePool = await ethers.getContractFactory("FxUSDBasePool", deployer);
    const ReservePool = await ethers.getContractFactory("ReservePool", deployer);
    const GaugeRewarder = await ethers.getContractFactory("GaugeRewarder", deployer);
    const MultiPathConverter = await ethers.getContractFactory("MultiPathConverter", deployer);

    const empty = await EmptyContract.deploy();
    converter = await MultiPathConverter.deploy("0x11C907b3aeDbD863e551c37f21DD3F36b28A6784");

    const PegKeeperProxy = await TransparentUpgradeableProxy.deploy(empty.getAddress(), proxyAdmin.getAddress(), "0x");
    const PoolManagerProxy = await TransparentUpgradeableProxy.deploy(
      empty.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );
    const FxUSDBasePoolProxy = await TransparentUpgradeableProxy.deploy(
      empty.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );

    // deploy ReservePool
    reservePool = await ReservePool.deploy(owner.address, PoolManagerProxy.getAddress());

    // deploy PoolManager
    const PoolManagerImpl = await PoolManager.deploy(
      fxUSD.getAddress(),
      FxUSDBasePoolProxy.getAddress(),
      PegKeeperProxy.getAddress()
    );
    await proxyAdmin.upgradeAndCall(
      PoolManagerProxy.getAddress(),
      PoolManagerImpl.getAddress(),
      PoolManager__factory.createInterface().encodeFunctionData("initialize", [
        owner.address,
        ethers.parseUnits("0.1", 9),
        ethers.parseUnits("0.01", 9),
        ethers.parseUnits("0.0001", 9),
        PLATFORM,
        PLATFORM,
        await reservePool.getAddress(),
      ])
    );
    poolManager = await ethers.getContractAt("PoolManager", await PoolManagerProxy.getAddress(), owner);

    // deploy FxUSDRegeneracy
    const FxUSDRegeneracyImpl = await FxUSDRegeneracy.deploy(
      PoolManagerProxy.getAddress(),
      usdc.getAddress(),
      PegKeeperProxy.getAddress()
    );
    await proxyAdmin.upgrade(fxUSD.getAddress(), FxUSDRegeneracyImpl.getAddress());
    await fxUSD.initializeV2();

    // deploy FxUSDBasePool
    const FxUSDBasePoolImpl = await FxUSDBasePool.deploy(
      PoolManagerProxy.getAddress(),
      PegKeeperProxy.getAddress(),
      fxUSD.getAddress(),
      usdc.getAddress(),
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["USDC-USD"].feed,
        ChainlinkPriceFeed.ethereum["USDC-USD"].scale,
        ChainlinkPriceFeed.ethereum["USDC-USD"].heartbeat
      )
    );
    await proxyAdmin.upgradeAndCall(
      FxUSDBasePoolProxy.getAddress(),
      FxUSDBasePoolImpl.getAddress(),
      FxUSDBasePool__factory.createInterface().encodeFunctionData("initialize", [
        owner.address,
        "fxUSD Save",
        "fxBASE",
        ethers.parseEther("0.95"),
        0n,
      ])
    );
    fxBASE = await ethers.getContractAt("FxUSDBasePool", await FxUSDBasePoolProxy.getAddress(), owner);

    // deploy PegKeeper
    const PegKeeperImpl = await PegKeeper.deploy(fxBASE.getAddress());
    await proxyAdmin.upgradeAndCall(
      PegKeeperProxy.getAddress(),
      PegKeeperImpl.getAddress(),
      PegKeeper__factory.createInterface().encodeFunctionData("initialize", [
        owner.address,
        await converter.getAddress(),
        Addresses["CRV_SN_USDC/fxUSD_193"],
      ])
    );
    pegKeeper = await ethers.getContractAt("PegKeeper", await PegKeeperProxy.getAddress(), owner);

    // deploy AaveFundingPool
    const AaveFundingPool = await ethers.getContractFactory("AaveFundingPool", owner);
    pool = await AaveFundingPool.deploy(
      poolManager.getAddress(),
      "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      EthereumTokens.USDC.address
    );
    await pool.initialize(owner.address, "f(x) wstETH position", "xstETH", wstETH.getAddress(), oracle.getAddress());
    await pool.updateDebtRatioRange(0n, ethers.parseEther("1"));
    await pool.updateRebalanceRatios(ethers.parseEther("0.88"), ethers.parseUnits("0.025", 9));
    await pool.updateLiquidateRatios(ethers.parseEther("0.92"), ethers.parseUnits("0.05", 9));

    // GaugeRewarder
    rewarder = await GaugeRewarder.deploy(fxBASE.getAddress());

    // deploy Facets and Diamond
    {
      const Diamond = await ethers.getContractFactory("Diamond", deployer);
      const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet", deployer);
      const DiamondLoupeFacet = await ethers.getContractFactory("DiamondLoupeFacet", deployer);
      const OwnershipFacet = await ethers.getContractFactory("OwnershipFacet", deployer);
      const RouterManagementFacet = await ethers.getContractFactory("RouterManagementFacet", deployer);
      const FlashLoanCallbackFacet = await ethers.getContractFactory("FlashLoanCallbackFacet", deployer);
      const PositionOperateFlashLoanFacet = await ethers.getContractFactory("PositionOperateFlashLoanFacet", deployer);
      const MigrateFacet = await ethers.getContractFactory("MigrateFacet", deployer);
      const cut = await DiamondCutFacet.deploy();
      const loupe = await DiamondLoupeFacet.deploy();
      const ownership = await OwnershipFacet.deploy();
      const routerManagement = await RouterManagementFacet.deploy();
      const flashLoanCallback = await FlashLoanCallbackFacet.deploy("0xBA12222222228d8Ba445958a75a0704d566BF2C8");
      const flashSwap = await PositionOperateFlashLoanFacet.deploy(
        "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
        poolManager.getAddress(),
        converter.getAddress()
      );
      const migrate = await MigrateFacet.deploy(
        "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
        poolManager.getAddress(),
        converter.getAddress()
      );

      const diamondCuts = [
        {
          facetAddress: await cut.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(DiamondCutFacet__factory.createInterface()),
        },
        {
          facetAddress: await loupe.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(DiamondLoupeFacet__factory.createInterface()),
        },
        {
          facetAddress: await ownership.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(OwnershipFacet__factory.createInterface()),
        },
        {
          facetAddress: await routerManagement.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(RouterManagementFacet__factory.createInterface()),
        },
        {
          facetAddress: await flashLoanCallback.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(FlashLoanCallbackFacet__factory.createInterface()),
        },
        {
          facetAddress: await flashSwap.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(PositionOperateFlashLoanFacet__factory.createInterface()),
        },
        {
          facetAddress: await migrate.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(MigrateFacet__factory.createInterface()),
        },
      ];

      router = await Diamond.deploy(diamondCuts, { owner: owner.address, init: ZeroAddress, initCalldata: "0x" });
      const manager = await ethers.getContractAt("RouterManagementFacet", await router.getAddress(), deployer);
      await manager.connect(owner).approveTarget(converter.getAddress(), converter.getAddress());
      await manager.connect(owner).updateRevenuePool(PLATFORM);
    }

    // initialization
    await poolManager
      .connect(owner)
      .registerPool(
        pool.getAddress(),
        rewarder.getAddress(),
        ethers.parseUnits("10000", 18),
        ethers.parseEther("100000000")
      );
    await poolManager.connect(owner).updateRateProvider(wstETH.getAddress(), rateProvider.getAddress());
    await poolManager.connect(owner).grantRole(id("OPERATOR_ROLE"), router.getAddress());
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
  const openOrAdd = async (
    token: MockERC20,
    holder: HardhatEthersSigner,
    amountIn: bigint,
    convertInRoute: {
      encoding: bigint;
      routes: bigint[];
    },
    leverage: bigint,
    slippage: bigint,
    positionId: number
  ): Promise<number> => {
    const routeFxUSDToWstETH = MULTI_PATH_CONVERTER_ROUTES.fxUSD.wstETH;
    const facet = await ethers.getContractAt("PositionOperateFlashLoanFacet", await router.getAddress(), deployer);
    const isETH = same(await token.getAddress(), ZeroAddress);
    const isWstETH = same(await token.getAddress(), EthereumTokens.wstETH.address);
    // approve when not ETH
    if (!isETH) {
      await token.connect(holder).approve(facet.getAddress(), amountIn);
    }

    let wstETHAmountIn = amountIn;
    if (!isWstETH) {
      wstETHAmountIn = await converter.queryConvert.staticCall(
        amountIn,
        convertInRoute.encoding,
        convertInRoute.routes
      );
    }

    // borrow wstETH is x, new mint fxUSD is y, and we have
    // ((wstETHAmountIn + x) * rate + currentColls) * minPrice * (1 - 1 / l) = currentDebts + y
    // x * rate * minPrice = y
    // we get
    // ((wstETHAmountIn + x) * rate + currentColls) * minPrice * (1 - 1 / l) = currentDebts + x * rate * minPrice
    // (wstETHAmountIn * rate + x * rate + currentColls) * minPrice * (1 - 1 / l) = currentDebts + x * rate * minPrice
    // (wstETHAmountIn * rate + currentColls) * minPrice * (1 - 1 / l) + x * rate * minPrice * (1 - 1 / l) = currentDebts + x * rate * minPrice
    // (wstETHAmountIn * rate + currentColls) * minPrice * (1 - 1 / l) - currentDebts = x * rate * minPrice / l
    // x = ((wstETHAmountIn * rate + currentColls) * minPrice * (l - 1) - currentDebts * l) / rate / minPrice
    // y = (wstETHAmountIn * rate + currentColls) * minPrice * (l - 1) - currentDebts * l
    const rate = await rateProvider.getRate();
    const [anchorPrice, minPrice] = await oracle.getPrice();
    const [currentColls, currentDebts] = await pool.getPosition(positionId);
    const hintFxUSDAmount =
      (((wstETHAmountIn * rate) / PRECISION + currentColls) * minPrice * (leverage - 1n)) / PRECISION -
      currentDebts * leverage;
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
      ((currentDebts + fxUSDAmount) * PRECISION * PRECISION * PRECISION) /
      (((borrowAmount + wstETHAmountIn) * rate + currentColls * PRECISION) * anchorPrice);
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256", "uint256[]"],
      [
        encodeMiscData(
          (targetDebtRatio * (10000n - slippage)) / 10000n,
          (targetDebtRatio * (10000n + slippage)) / 10000n
        ),
        fxUSDAmount,
        routeFxUSDToWstETH.encoding,
        routeFxUSDToWstETH.routes,
      ]
    );
    console.log(
      `SearchTimes[${searchTimes}]`,
      `${isETH ? "ETH" : await token.symbol()}Supplied[${ethers.formatUnits(
        amountIn,
        isETH ? 18 : await token.decimals()
      )}]`,
      `wstETHToSupply[${ethers.formatEther(wstETHAmountIn)}]`,
      `wstETHToBorrow[${ethers.formatEther(borrowAmount)}]`,
      `fxUSDToMint[${ethers.formatEther(fxUSDAmount)}]`,
      `TargetDebtRatio[${ethers.formatEther(targetDebtRatio)}]`
    );
    const wstETHBefore = await wstETH.balanceOf(PLATFORM);
    if (positionId > 0) {
      await pool.connect(holder).approve(facet.getAddress(), positionId);
    }
    await facet.connect(holder).openOrAddPositionFlashLoan(
      {
        tokenIn: await token.getAddress(),
        amount: amountIn,
        target: await converter.getAddress(),
        data: converter.interface.encodeFunctionData("convert", [
          await token.getAddress(),
          amountIn,
          convertInRoute.encoding,
          convertInRoute.routes,
        ]),
        minOut: 0n,
        signature: "0x",
      },
      pool.getAddress(),
      positionId,
      borrowAmount,
      data,
      {
        value: isETH ? amountIn : 0n,
      }
    );
    if (positionId === 0) positionId = 1;
    const wstETHAfter = await wstETH.balanceOf(PLATFORM);
    const [colls, debts] = await pool.getPosition(positionId);
    const debtRatio = await pool.getPositionDebtRatio(positionId);
    console.log(
      `RawColl[${ethers.formatEther(colls)}]`,
      `RawDebt[${ethers.formatEther(debts)}]`,
      `DebtRatio[${ethers.formatEther(debtRatio)}]`,
      `wstETHRefund[${ethers.formatEther(wstETHAfter - wstETHBefore)}]`
    );
    return positionId;
  };

  context("open position or add collateral", async () => {
    it("should succeed when open with wstETH", async () => {
      const HOLDER = "0x3c22ec75ea5D745c78fc84762F7F1E6D82a2c5BF";
      await unlockAccounts([HOLDER]);
      const holder = await ethers.getSigner(HOLDER);
      await mockETHBalance(HOLDER, ethers.parseEther("100"));

      // open with 10 wstETH, 3x leverage
      const position = await openOrAdd(
        wstETH,
        holder,
        ethers.parseEther("10"),
        { encoding: 0n, routes: [] },
        3n,
        30n,
        0
      );

      // add 2 wstETH, 4x leverage
      await openOrAdd(wstETH, holder, ethers.parseEther("2"), { encoding: 0n, routes: [] }, 4n, 30n, position);
    });

    it("should succeed when open with stETH", async () => {
      const HOLDER = "0x176F3DAb24a159341c0509bB36B833E7fdd0a132";
      await unlockAccounts([HOLDER]);
      const holder = await ethers.getSigner(HOLDER);
      await mockETHBalance(HOLDER, ethers.parseEther("100"));
      const token = await ethers.getContractAt("MockERC20", EthereumTokens.stETH.address, holder);

      // open with 10 stETH, 3x leverage
      const position = await openOrAdd(
        token,
        holder,
        ethers.parseEther("10"),
        MULTI_PATH_CONVERTER_ROUTES.stETH.wstETH,
        3n,
        30n,
        0
      );

      // add 2 stETH, 4x leverage
      await openOrAdd(
        token,
        holder,
        ethers.parseEther("2"),
        MULTI_PATH_CONVERTER_ROUTES.stETH.wstETH,
        4n,
        30n,
        position
      );
    });

    it("should succeed when open with ETH", async () => {
      const HOLDER = "0x176F3DAb24a159341c0509bB36B833E7fdd0a132";
      await unlockAccounts([HOLDER]);
      const holder = await ethers.getSigner(HOLDER);
      await mockETHBalance(HOLDER, ethers.parseEther("100"));
      const token = await ethers.getContractAt("MockERC20", ZeroAddress, holder);

      // open with 10 ETH, 3x leverage
      const position = await openOrAdd(
        token,
        holder,
        ethers.parseEther("10"),
        MULTI_PATH_CONVERTER_ROUTES.WETH.wstETH,
        3n,
        30n,
        0
      );

      // add 2 ETH, 4x leverage
      await openOrAdd(
        token,
        holder,
        ethers.parseEther("2"),
        MULTI_PATH_CONVERTER_ROUTES.WETH.wstETH,
        4n,
        30n,
        position
      );
    });

    it("should succeed when open with WETH", async () => {
      const HOLDER = "0x8EB8a3b98659Cce290402893d0123abb75E3ab28";
      await unlockAccounts([HOLDER]);
      const holder = await ethers.getSigner(HOLDER);
      await mockETHBalance(HOLDER, ethers.parseEther("100"));
      const token = await ethers.getContractAt("MockERC20", EthereumTokens.WETH.address, holder);

      // open with 10 WETH, 3x leverage
      const position = await openOrAdd(
        token,
        holder,
        ethers.parseEther("10"),
        MULTI_PATH_CONVERTER_ROUTES.WETH.wstETH,
        3n,
        30n,
        0
      );

      // add 2 WETH, 4x leverage
      await openOrAdd(
        token,
        holder,
        ethers.parseEther("2"),
        MULTI_PATH_CONVERTER_ROUTES.WETH.wstETH,
        4n,
        30n,
        position
      );
    });

    it("should succeed when open with USDC", async () => {
      const HOLDER = "0x8EB8a3b98659Cce290402893d0123abb75E3ab28";
      await unlockAccounts([HOLDER]);
      const holder = await ethers.getSigner(HOLDER);
      await mockETHBalance(HOLDER, ethers.parseEther("100"));
      const token = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, holder);

      // open with 100000 USDC, 3x leverage
      const position = await openOrAdd(
        token,
        holder,
        ethers.parseUnits("100000", 6),
        MULTI_PATH_CONVERTER_ROUTES.USDC.wstETH,
        3n,
        30n,
        0
      );

      // add 2000 USDC, 4x leverage
      await openOrAdd(
        token,
        holder,
        ethers.parseUnits("2000", 6),
        MULTI_PATH_CONVERTER_ROUTES.USDC.wstETH,
        4n,
        30n,
        position
      );
    });

    it("should succeed when open with fxUSD", async () => {
      const HOLDER = "0xB1Fb33bF3A036742FFFAa9F96C548AcB0aE6a4bB";
      await unlockAccounts([HOLDER]);
      const holder = await ethers.getSigner(HOLDER);
      await mockETHBalance(HOLDER, ethers.parseEther("100"));
      const token = await ethers.getContractAt("MockERC20", EthereumTokens.fxUSD.address, holder);

      // open with 10000 fxUSD, 3x leverage
      const position = await openOrAdd(
        token,
        holder,
        ethers.parseUnits("10000", 18),
        MULTI_PATH_CONVERTER_ROUTES.fxUSD.wstETH,
        3n,
        30n,
        0
      );

      // add 200 fxUSD, 4x leverage
      await openOrAdd(
        token,
        holder,
        ethers.parseUnits("200", 18),
        MULTI_PATH_CONVERTER_ROUTES.fxUSD.wstETH,
        4n,
        30n,
        position
      );
    });
  });

  const closeOrRemove = async (
    token: MockERC20,
    holder: HardhatEthersSigner,
    wstETHToWithdraw: bigint,
    convertOutRoute: {
      encoding: bigint;
      routes: bigint[];
    },
    leverage: number,
    slippage: bigint,
    positionId: number
  ) => {
    const routeWstETHToFxUSD = MULTI_PATH_CONVERTER_ROUTES.wstETH.fxUSD;
    const facet = await ethers.getContractAt("PositionOperateFlashLoanFacet", await router.getAddress(), deployer);
    const targetDebtRatio = leverage === 0 ? PRECISION : ethers.parseEther(((leverage - 1) / leverage).toFixed(9));
    const isETH = same(await token.getAddress(), ZeroAddress);
    const isWstETH = same(await token.getAddress(), EthereumTokens.wstETH.address);
    // assume borrow x, repay y fxUSD, and we have
    // x * rate * minPrice = y
    // (currentColls - wstETHToWithdraw * rate) * minPrice * targetDebtRatio = currentDebts - y
    // we get
    // y = currentDebts - (currentColls - wstETHToWithdraw * rate) * minPrice * targetDebtRatio
    // x = y / rate / minPrice
    const rate = await rateProvider.getRate();
    const [currentColls, currentDebts] = await pool.getPosition(positionId);
    const [, minPrice] = await oracle.getPrice();
    // targetLeverage = 0 means close position
    const fxUSDAmount =
      leverage === 0
        ? currentDebts
        : currentDebts -
          ((((currentColls - (wstETHToWithdraw * rate) / PRECISION) * minPrice) / PRECISION) * targetDebtRatio) /
            PRECISION;
    if (fxUSDAmount > currentDebts || fxUSDAmount < 0n) throw Error("cannot remove or close to given leverage");
    if (leverage === 0) {
      // the value doesn't matter
      wstETHToWithdraw = (currentColls * PRECISION) / rate;
    }
    const hintWstETHToBorrow = (fxUSDAmount * PRECISION * PRECISION) / (rate * minPrice);
    // binary search to wstETH borrow amount, precision 0.00001 wstETH
    let [searchTimes, wstETHToBorrow] = await searchAmount(
      hintWstETHToBorrow,
      hintWstETHToBorrow * 2n,
      fxUSDAmount,
      routeWstETHToFxUSD,
      ethers.parseEther("0.00001")
    );
    wstETHToBorrow = (wstETHToBorrow * (10000n + slippage)) / 10000n;
    const closeFeeRatio = await pool.getCloseFeeRatio();
    const wstETHExpected = (wstETHToWithdraw * (10n ** 9n - closeFeeRatio)) / 10n ** 9n - wstETHToBorrow;
    const minOut =
      ((isWstETH
        ? wstETHExpected
        : await converter.queryConvert.staticCall(wstETHExpected, convertOutRoute.encoding, convertOutRoute.routes)) *
        (10000n - slippage)) /
      10000n;
    console.log(
      `SearchTimes[${searchTimes}]`,
      `CurrentColls[${ethers.formatEther(currentColls)}]`,
      `CurrentDebts[${ethers.formatEther(currentDebts)}]`,
      `wstETHToWithdraw[${ethers.formatEther(wstETHToWithdraw)}]`,
      `wstETHToBorrow[${ethers.formatEther(wstETHToBorrow)}]`,
      `fxUSDToRepay[${ethers.formatEther(fxUSDAmount)}]`,
      `TargetDebtRatio[${ethers.formatEther(targetDebtRatio)}]`,
      `Min${isETH ? "ETH" : await token.symbol()}Out[${ethers.formatUnits(
        minOut,
        isETH ? 18 : await token.decimals()
      )}]`
    );
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256", "uint256[]"],
      [
        encodeMiscData(
          (targetDebtRatio * (10000n - slippage)) / 10000n,
          (targetDebtRatio * (10000n + slippage)) / 10000n
        ),
        fxUSDAmount,
        routeWstETHToFxUSD.encoding,
        routeWstETHToFxUSD.routes,
      ]
    );
    const fxUSDBefore = await fxUSD.balanceOf(PLATFORM);
    const balanceBefore = isETH
      ? await ethers.provider.getBalance(holder.address)
      : await token.balanceOf(holder.address);
    await pool.connect(holder).approve(facet.getAddress(), positionId);
    const tx = await facet.connect(holder).closeOrRemovePositionFlashLoan(
      {
        tokenOut: await token.getAddress(),
        converter: await converter.getAddress(),
        encodings: convertOutRoute.encoding,
        routes: convertOutRoute.routes,
        minOut: minOut,
        signature: "0x",
      },
      pool.getAddress(),
      positionId,
      wstETHToWithdraw,
      wstETHToBorrow,
      data
    );
    const r = await tx.wait();
    const fxUSDAfter = await fxUSD.balanceOf(PLATFORM);
    const balanceAfter = isETH
      ? await ethers.provider.getBalance(holder.address)
      : await token.balanceOf(holder.address);
    const [colls, debts] = await pool.getPosition(positionId);
    const debtRatio = await pool.getPositionDebtRatio(positionId);
    console.log(
      `RawColl[${ethers.formatEther(colls)}]`,
      `RawDebt[${ethers.formatEther(debts)}]`,
      `DebtRatio[${ethers.formatEther(debtRatio)}]`,
      `fxUSDRefund[${ethers.formatEther(fxUSDAfter - fxUSDBefore)}]`,
      `${isETH ? "ETH" : await token.symbol()}Withdrawn[${ethers.formatUnits(
        balanceAfter - balanceBefore + (isETH ? r!.gasPrice * r!.gasUsed : 0n),
        isETH ? 18 : await token.decimals()
      )}]`
    );
  };

  context("close position or remove collateral", async () => {
    let holder: HardhatEthersSigner;

    beforeEach(async () => {
      const HOLDER = "0x3c22ec75ea5D745c78fc84762F7F1E6D82a2c5BF";
      await unlockAccounts([HOLDER]);
      holder = await ethers.getSigner(HOLDER);
      await mockETHBalance(HOLDER, ethers.parseEther("100"));

      // open with 10 wstETH, 3x leverage
      await openOrAdd(wstETH, holder, ethers.parseEther("10"), { encoding: 0n, routes: [] }, 3n, 30n, 0);
      // another open with 1 wstETH, 2x leverage
      await openOrAdd(wstETH, holder, ethers.parseEther("1"), { encoding: 0n, routes: [] }, 2n, 30n, 0);
    });

    it("should succeed when close to wstETH", async () => {
      // partial close
      await closeOrRemove(wstETH, holder, ethers.parseEther("1"), { encoding: 0n, routes: [] }, 3, 30n, 1);
      // full close
      await closeOrRemove(wstETH, holder, ethers.parseEther("1"), { encoding: 0n, routes: [] }, 0, 5n, 2);
    });

    it("should succeed when close to stETH", async () => {
      const token = await ethers.getContractAt("MockERC20", EthereumTokens.stETH.address, holder);
      // partial close
      await closeOrRemove(token, holder, ethers.parseEther("1"), MULTI_PATH_CONVERTER_ROUTES.wstETH.stETH, 3, 30n, 1);
      // full close
      await closeOrRemove(token, holder, ethers.parseEther("1"), MULTI_PATH_CONVERTER_ROUTES.wstETH.stETH, 0, 5n, 2);
    });

    it("should succeed when close to ETH", async () => {
      const token = await ethers.getContractAt("MockERC20", ZeroAddress, holder);
      // partial close
      await closeOrRemove(token, holder, ethers.parseEther("1"), MULTI_PATH_CONVERTER_ROUTES.wstETH.WETH, 3, 30n, 1);
      // full close
      await closeOrRemove(token, holder, ethers.parseEther("1"), MULTI_PATH_CONVERTER_ROUTES.wstETH.WETH, 0, 5n, 2);
    });

    it("should succeed when close to WETH", async () => {
      const token = await ethers.getContractAt("MockERC20", EthereumTokens.WETH.address, holder);
      // partial close
      await closeOrRemove(token, holder, ethers.parseEther("1"), MULTI_PATH_CONVERTER_ROUTES.wstETH.WETH, 3, 30n, 1);
      // full close
      await closeOrRemove(token, holder, ethers.parseEther("1"), MULTI_PATH_CONVERTER_ROUTES.wstETH.WETH, 0, 5n, 2);
    });

    it("should succeed when close to USDC", async () => {
      const token = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, holder);
      // partial close
      await closeOrRemove(token, holder, ethers.parseEther("1"), MULTI_PATH_CONVERTER_ROUTES.wstETH.USDC, 3, 30n, 1);
      // full close
      await closeOrRemove(token, holder, ethers.parseEther("1"), MULTI_PATH_CONVERTER_ROUTES.wstETH.USDC, 0, 5n, 2);
    });
  });
});
