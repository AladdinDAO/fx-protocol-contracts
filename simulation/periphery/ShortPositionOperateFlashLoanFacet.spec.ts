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
  IRateProvider,
  PoolConfiguration,
  ShortPoolManager,
  FxUSDPriceOracle,
  CreditNote,
  ShortPool,
  InverseStETHPriceOracle,
  ShortPositionOperateFlashLoanFacet__factory,
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

const FORK_HEIGHT = 22701380;
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

describe("ShortPositionOperateFlashLoanFacet.spec", async () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;

  let proxyAdmin: ProxyAdmin;

  let fxUSD: FxUSDRegeneracy;
  let usdc: MockERC20;
  let wstETH: MockERC20;

  let stETHPriceOracle: StETHPriceOracle;
  let inverseStETHPriceOracle: InverseStETHPriceOracle;
  let rateProvider: IRateProvider;

  let configuration: PoolConfiguration;
  let longPoolManager: PoolManager;
  let shortPoolManager: ShortPoolManager;
  let fxBASE: FxUSDBasePool;

  let wstETHLongPool: AaveFundingPool;
  let wstETHShortPool: ShortPool;

  let fxUSDPriceOracle: FxUSDPriceOracle;
  let creditNote: CreditNote;

  let converter: MultiPathConverter;
  let router: Diamond;

  beforeEach(async () => {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [DEPLOYER, OWNER]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    await mockETHBalance(OWNER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);
    owner = await ethers.getSigner(OWNER);

    proxyAdmin = await ethers.getContractAt("ProxyAdmin", "0x9B54B7703551D9d0ced177A78367560a8B2eDDA4", owner);
    longPoolManager = await ethers.getContractAt("PoolManager", "0x250893CA4Ba5d05626C785e8da758026928FCD24", owner);
    wstETHLongPool = await ethers.getContractAt("AaveFundingPool", "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8", owner);
    fxBASE = await ethers.getContractAt("FxUSDBasePool", "0x65C9A641afCEB9C0E6034e558A319488FA0FA3be", owner);
    stETHPriceOracle = await ethers.getContractAt(
      "StETHPriceOracle",
      "0x3716352d57C2e48EEdB56Ee0712Ef29E0c2f3069",
      owner
    );
    rateProvider = await ethers.getContractAt("IRateProvider", "0x81A777c4aB65229d1Bf64DaE4c831bDf628Ccc7f", deployer);

    const MultiPathConverter = await ethers.getContractFactory("MultiPathConverter", deployer);
    converter = await MultiPathConverter.deploy("0x11C907b3aeDbD863e551c37f21DD3F36b28A6784");

    fxUSD = await ethers.getContractAt("FxUSDRegeneracy", EthereumTokens.fxUSD.address, deployer);
    usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, deployer);
    wstETH = await ethers.getContractAt("MockERC20", EthereumTokens.wstETH.address, deployer);

    const EmptyContract = await ethers.getContractFactory("EmptyContract", deployer);
    const TransparentUpgradeableProxy = await ethers.getContractFactory("TransparentUpgradeableProxy", deployer);
    const empty = await EmptyContract.deploy();

    const PoolConfigurationProxy = await TransparentUpgradeableProxy.deploy(
      empty.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );
    const CreditNoteProxy = await TransparentUpgradeableProxy.deploy(empty.getAddress(), proxyAdmin.getAddress(), "0x");
    const ShortPoolProxy = await TransparentUpgradeableProxy.deploy(empty.getAddress(), proxyAdmin.getAddress(), "0x");
    const FxUSDPriceOracleProxy = await TransparentUpgradeableProxy.deploy(
      empty.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );
    const ShortPoolManagerProxy = await TransparentUpgradeableProxy.deploy(
      empty.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );

    const PoolManager = await ethers.getContractFactory("PoolManager", deployer);
    const PoolManagerImpl = await PoolManager.deploy(
      fxUSD.getAddress(),
      fxBASE.getAddress(),
      ShortPoolManagerProxy.getAddress(),
      PoolConfigurationProxy.getAddress()
    );
    await proxyAdmin.upgrade(longPoolManager.getAddress(), PoolManagerImpl.getAddress());

    const FxUSDPriceOracle = await ethers.getContractFactory("FxUSDPriceOracle", deployer);
    const FxUSDPriceOracleImpl = await FxUSDPriceOracle.deploy(fxUSD.getAddress());
    await proxyAdmin.upgrade(FxUSDPriceOracleProxy.getAddress(), FxUSDPriceOracleImpl.getAddress());
    fxUSDPriceOracle = await ethers.getContractAt(
      "FxUSDPriceOracle",
      await FxUSDPriceOracleProxy.getAddress(),
      deployer
    );
    await fxUSDPriceOracle.initialize(deployer.address, Addresses["CRV_SN_USDC/fxUSD_193"]);

    const PoolConfiguration = await ethers.getContractFactory("PoolConfiguration", deployer);
    const PoolConfigurationImpl = await PoolConfiguration.deploy(
      fxBASE.getAddress(),
      "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    );
    await proxyAdmin.upgrade(PoolConfigurationProxy.getAddress(), PoolConfigurationImpl.getAddress());
    configuration = await ethers.getContractAt(
      "PoolConfiguration",
      await PoolConfigurationProxy.getAddress(),
      deployer
    );
    await configuration.initialize(deployer.address, fxUSDPriceOracle.getAddress());

    const AaveFundingPool = await ethers.getContractFactory("AaveFundingPool", deployer);
    const AaveFundingPoolImpl = await AaveFundingPool.deploy(longPoolManager.getAddress(), configuration.getAddress());
    await proxyAdmin.upgrade(wstETHLongPool.getAddress(), AaveFundingPoolImpl.getAddress());

    const ShortPoolManager = await ethers.getContractFactory("ShortPoolManager", deployer);
    const ShortPoolManagerImpl = await ShortPoolManager.deploy(
      fxUSD.getAddress(),
      longPoolManager.getAddress(),
      configuration.getAddress()
    );
    await proxyAdmin.upgrade(ShortPoolManagerProxy.getAddress(), ShortPoolManagerImpl.getAddress());
    shortPoolManager = await ethers.getContractAt(
      "ShortPoolManager",
      await ShortPoolManagerProxy.getAddress(),
      deployer
    );
    await shortPoolManager.initialize(deployer.address, 0, 0, 0, deployer.address, deployer.address, deployer.address);

    const CreditNote = await ethers.getContractFactory("CreditNote", deployer);
    const CreditNoteImpl = await CreditNote.deploy(longPoolManager.getAddress());
    await proxyAdmin.upgrade(CreditNoteProxy.getAddress(), CreditNoteImpl.getAddress());
    creditNote = await ethers.getContractAt("CreditNote", await CreditNoteProxy.getAddress(), deployer);

    const InverseStETHPriceOracle = await ethers.getContractFactory("InverseStETHPriceOracle", deployer);
    inverseStETHPriceOracle = await InverseStETHPriceOracle.deploy(stETHPriceOracle.getAddress());

    const ShortPool = await ethers.getContractFactory("ShortPool", deployer);
    const ShortPoolImpl = await ShortPool.deploy(
      ShortPoolManagerProxy.getAddress(),
      PoolConfigurationProxy.getAddress()
    );
    await proxyAdmin.upgrade(ShortPoolProxy.getAddress(), ShortPoolImpl.getAddress());
    wstETHShortPool = await ethers.getContractAt("ShortPool", await ShortPoolProxy.getAddress(), deployer);
    await wstETHShortPool.initialize(
      deployer.address,
      "xx",
      "ww",
      inverseStETHPriceOracle.getAddress(),
      wstETH.getAddress(),
      creditNote.getAddress()
    );

    await configuration.updatePoolFeeRatio(wstETHLongPool.getAddress(), ZeroAddress, 0, 1, 0, 0, 0);
    await wstETHLongPool.updateCounterparty(wstETHShortPool.getAddress());
    await longPoolManager.updateShortBorrowCapacityRatio(wstETHLongPool.getAddress(), ethers.parseEther("10000"));

    await shortPoolManager.registerPool(
      wstETHShortPool.getAddress(),
      deployer.address,
      ethers.parseEther("1000000000"),
      ethers.parseEther("1000000000"),
      0
    );
    await shortPoolManager.updateRateProvider(wstETH.getAddress(), rateProvider.getAddress());
    await configuration.updatePoolFeeRatio(wstETHShortPool.getAddress(), ZeroAddress, 0, 1, 0, 0, 0);
    await wstETHShortPool.updateCounterparty(wstETHLongPool.getAddress());
    await wstETHShortPool.updateDebtRatioRange(0, ethers.parseEther("1"));
    await wstETHShortPool.updateRebalanceRatios(ethers.parseEther("0.88"), 5e7);
    await wstETHShortPool.updateLiquidateRatios(ethers.parseEther("0.92"), 5e7);
    await fxUSDPriceOracle.updateMaxPriceDeviation(ethers.parseEther("0.1"), ethers.parseEther("0.1"));

    // deploy Facets and Diamond
    {
      const Diamond = await ethers.getContractFactory("Diamond", deployer);
      const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet", deployer);
      const DiamondLoupeFacet = await ethers.getContractFactory("DiamondLoupeFacet", deployer);
      const OwnershipFacet = await ethers.getContractFactory("OwnershipFacet", deployer);
      const RouterManagementFacet = await ethers.getContractFactory("RouterManagementFacet", deployer);
      const MorphoFlashLoanCallbackFacet = await ethers.getContractFactory("MorphoFlashLoanCallbackFacet", deployer);
      const ShortPositionOperateFlashLoanFacet = await ethers.getContractFactory(
        "ShortPositionOperateFlashLoanFacet",
        deployer
      );
      const cut = await DiamondCutFacet.deploy();
      const loupe = await DiamondLoupeFacet.deploy();
      const ownership = await OwnershipFacet.deploy();
      const routerManagement = await RouterManagementFacet.deploy();
      const morphoFlashLoanCallback = await MorphoFlashLoanCallbackFacet.deploy(
        "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb"
      );
      const shortPositionOperate = await ShortPositionOperateFlashLoanFacet.deploy(
        "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
        shortPoolManager.getAddress()
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
          facetAddress: await morphoFlashLoanCallback.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(morphoFlashLoanCallback.interface),
        },
        {
          facetAddress: await shortPositionOperate.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(ShortPositionOperateFlashLoanFacet__factory.createInterface()),
        },
      ];

      router = await Diamond.deploy(diamondCuts, { owner: owner.address, init: ZeroAddress, initCalldata: "0x" });
      const manager = await ethers.getContractAt("RouterManagementFacet", await router.getAddress(), deployer);
      await manager.connect(owner).approveTarget(converter.getAddress(), converter.getAddress());
      await manager.connect(owner).updateRevenuePool(PLATFORM);
    }
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

  // assume all wstETH will sell to fxUSD
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
    const routeWstETHToFxUSD = MULTI_PATH_CONVERTER_ROUTES.wstETH.fxUSD;
    const facet = await ethers.getContractAt("ShortPositionOperateFlashLoanFacet", await router.getAddress(), deployer);
    await token.connect(holder).approve(facet.getAddress(), amountIn);

    let fxUSDAmountIn = amountIn;
    if (same(await token.getAddress(), EthereumTokens.fxUSD.address)) {
      fxUSDAmountIn = amountIn;
    } else {
      fxUSDAmountIn = await converter.queryConvert.staticCall(amountIn, convertInRoute.encoding, convertInRoute.routes);
    }

    // flashloan wstETH is x (also the new borrowed wstETH), and we have
    // (fxUSDAmountIn + currentColls + x * rate / price) * price * (1 - 1 / l) = currentDebts + x * rate
    // we get
    //   (fxUSDAmountIn + currentColls) * price * (1 - 1 / l) + x * rate * (1 - 1 / l) = currentDebts + x * rate
    //   (fxUSDAmountIn + currentColls) * price * (1 - 1 / l) - currentDebts = x * rate / l
    // x = ((fxUSDAmountIn + currentColls) * price * (l - 1) - currentDebts * l) / rate
    const rate = await rateProvider.getRate();
    const exchangePrice = await inverseStETHPriceOracle.getExchangePrice();
    const [currentColls, currentDebts] = await wstETHShortPool.getPosition(positionId);
    const borrowWstETHAmount =
      ((((fxUSDAmountIn + currentColls) * exchangePrice * (leverage - 1n)) / PRECISION - currentDebts * leverage) *
        PRECISION) /
      rate;
    if (borrowWstETHAmount <= 0n) throw Error("cannot open or add to given leverage");

    // add slippage
    const minFxUSD = await converter.queryConvert.staticCall(
      borrowWstETHAmount,
      routeWstETHToFxUSD.encoding,
      routeWstETHToFxUSD.routes
    );
    console.log(
      `fxUSDAmountIn[${ethers.formatEther(fxUSDAmountIn)}]`,
      `currentColls[${ethers.formatEther(currentColls)}]`,
      `currentDebts[${ethers.formatEther(currentDebts)}]`,
      `exchangePrice[${ethers.formatEther(exchangePrice)}]`,
      `borrowedWstETH[${ethers.formatEther(borrowWstETHAmount)}]`,
      `swappedFxUSD[${ethers.formatEther(minFxUSD)}]`
    );
    const targetDebtRatio = ((leverage - 1n) * PRECISION) / leverage;
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "address", "bytes"],
      [
        encodeMiscData(
          (targetDebtRatio * (10000n - slippage)) / 10000n,
          (targetDebtRatio * (10000n + slippage)) / 10000n
        ),
        (minFxUSD * (10000n - slippage)) / 10000n,
        await converter.getAddress(),
        converter.interface.encodeFunctionData("convert", [
          await wstETH.getAddress(),
          borrowWstETHAmount,
          routeWstETHToFxUSD.encoding,
          routeWstETHToFxUSD.routes,
        ]),
      ]
    );
    if (positionId > 0) {
      await wstETHShortPool.connect(holder).approve(facet.getAddress(), positionId);
    }
    await facet.connect(holder).openOrAddShortPositionFlashLoan(
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
      wstETHShortPool.getAddress(),
      positionId,
      borrowWstETHAmount,
      data
    );
    if (positionId === 0) {
      positionId = Number(await wstETHShortPool.getNextPositionId()) - 1;
    }
    const [colls, debts] = await wstETHShortPool.getPosition(positionId);
    const debtRatio = await wstETHShortPool.getPositionDebtRatio(positionId);
    console.log(
      `Position[${positionId}]`,
      `RawColl[${ethers.formatEther(colls)}]`,
      `RawDebt[${ethers.formatEther(debts)}]`,
      `DebtRatio[${ethers.formatEther(debtRatio)}]`
    );
    return positionId;
  };

  const closeOrRemove = async (
    token: MockERC20,
    holder: HardhatEthersSigner,
    fxUSDToWithdraw: bigint,
    convertOutRoute: {
      encoding: bigint;
      routes: bigint[];
    },
    leverage: number,
    slippage: bigint,
    positionId: number
  ) => {
    const routeFxUSDToWstETH = MULTI_PATH_CONVERTER_ROUTES.fxUSD.wstETH;
    const facet = await ethers.getContractAt("ShortPositionOperateFlashLoanFacet", await router.getAddress(), deployer);
    const targetDebtRatio = leverage === 0 ? PRECISION : ethers.parseEther(((leverage - 1) / leverage).toFixed(9));

    // assume flashloan x debt token and withdraw y fxUSD, we have
    // (currentColls - y) * price * (1 - 1 / l) = currentDebts - x * rate
    // we get
    // x = (currentDebts - (currentColls - y) * price * (1 - 1 / l)) / rate
    const rate = await rateProvider.getRate();
    const [currentColls, currentDebts] = await wstETHShortPool.getPosition(positionId);
    const exchangePrice = await inverseStETHPriceOracle.getExchangePrice();
    // targetLeverage = 0 means close position
    const fxUSDAmount = leverage === 0 ? currentColls : fxUSDToWithdraw;
    let wstETHAmount =
      ((leverage === 0
        ? currentDebts
        : currentDebts - ((currentColls - fxUSDAmount) * exchangePrice * targetDebtRatio) / PRECISION / PRECISION) *
        PRECISION) /
      rate;
    if (fxUSDAmount > currentColls || wstETHAmount < 0n) throw Error("cannot remove or close to given leverage");

    const hintFxUSDToSwap = (wstETHAmount * rate) / exchangePrice;
    // binary search to wstETH borrow amount, precision 0.00001 wstETH
    let [searchTimes, fxUSDToSwap] = await searchAmount(
      hintFxUSDToSwap,
      hintFxUSDToSwap * 2n,
      wstETHAmount,
      routeFxUSDToWstETH,
      ethers.parseEther("0.1")
    );
    fxUSDToSwap = (fxUSDToSwap * (10000n + slippage)) / 10000n; // add slippage
    let minOut = same(await token.getAddress(), EthereumTokens.fxUSD.address)
      ? fxUSDAmount - fxUSDToSwap
      : await converter.queryConvert.staticCall(
          fxUSDAmount - fxUSDToSwap,
          convertOutRoute.encoding,
          convertOutRoute.routes
        );
    minOut = (minOut * (10000n - slippage)) / 10000n; // add slippage
    console.log(
      `SearchTimes[${searchTimes}]`,
      `CurrentColls[${ethers.formatEther(currentColls)}]`,
      `CurrentDebts[${ethers.formatEther(currentDebts)}]`,
      `fxUSDToWithdraw[${ethers.formatEther(fxUSDAmount)}]`,
      `fxUSDToSwap[${ethers.formatEther(fxUSDToSwap)}]`,
      `wstETHAmount[${ethers.formatEther(wstETHAmount)}]`,
      `MinOut[${ethers.formatUnits(minOut, await token.decimals())}]`,
      `TargetDebtRatio[${ethers.formatEther(targetDebtRatio)}]`
    );
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "address", "bytes"],
      [
        encodeMiscData(
          (targetDebtRatio * (10000n - slippage * 2n)) / 10000n,
          (targetDebtRatio * (10000n + slippage * 2n)) / 10000n
        ),
        fxUSDToSwap,
        await converter.getAddress(),
        converter.interface.encodeFunctionData("convert", [
          await fxUSD.getAddress(),
          fxUSDToSwap,
          routeFxUSDToWstETH.encoding,
          routeFxUSDToWstETH.routes,
        ]),
      ]
    );
    await wstETHShortPool.connect(holder).approve(facet.getAddress(), positionId);
    await facet.connect(holder).closeOrRemoveShortPositionFlashLoan(
      {
        tokenOut: await token.getAddress(),
        converter: await converter.getAddress(),
        encodings: convertOutRoute.encoding,
        routes: convertOutRoute.routes,
        minOut: minOut,
        signature: "0x",
      },
      wstETHShortPool.getAddress(),
      positionId,
      fxUSDAmount,
      wstETHAmount,
      data
    );
    const [colls, debts] = await wstETHShortPool.getPosition(positionId);
    const debtRatio = await wstETHShortPool.getPositionDebtRatio(positionId);
    console.log(
      `RawColl[${ethers.formatEther(colls)}]`,
      `RawDebt[${ethers.formatEther(debts)}]`,
      `DebtRatio[${ethers.formatEther(debtRatio)}]`
    );
  };

  context("open position", () => {
    it("should succeed when open position with fxUSD", async () => {
      const HOLDER = "0xB1Fb33bF3A036742FFFAa9F96C548AcB0aE6a4bB";
      await unlockAccounts([HOLDER]);
      const holder = await ethers.getSigner(HOLDER);
      await mockETHBalance(HOLDER, ethers.parseEther("100"));

      // open short position with 2x leverage
      const position1 = await openOrAdd(
        fxUSD as any,
        holder,
        ethers.parseEther("10000"),
        { encoding: 0n, routes: [] },
        2n,
        30n,
        0
      );

      // open short position with 3x leverage
      await openOrAdd(fxUSD as any, holder, ethers.parseEther("10000"), { encoding: 0n, routes: [] }, 3n, 30n, 0);

      // add to position 1, make it 4x
      await openOrAdd(
        fxUSD as any,
        holder,
        ethers.parseEther("10000"),
        { encoding: 0n, routes: [] },
        4n,
        30n,
        position1
      );
    });

    it("should succeed when open position with USDC", async () => {
      const HOLDER = "0x8EB8a3b98659Cce290402893d0123abb75E3ab28";
      await unlockAccounts([HOLDER]);
      const holder = await ethers.getSigner(HOLDER);
      const USDC = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, holder);
      await mockETHBalance(HOLDER, ethers.parseEther("100"));

      // open short position with 2x leverage
      const position1 = await openOrAdd(
        USDC,
        holder,
        ethers.parseUnits("10000", 6),
        MULTI_PATH_CONVERTER_ROUTES.USDC.fxUSD,
        2n,
        30n,
        0
      );

      // open short position with 3x leverage
      await openOrAdd(USDC, holder, ethers.parseUnits("10000", 6), MULTI_PATH_CONVERTER_ROUTES.USDC.fxUSD, 3n, 30n, 0);

      // add to position 1, make it 4x
      await openOrAdd(
        USDC,
        holder,
        ethers.parseUnits("10000", 6),
        MULTI_PATH_CONVERTER_ROUTES.USDC.fxUSD,
        4n,
        30n,
        position1
      );
    });
  });

  context("close position", () => {
    let holder: HardhatEthersSigner;
    let position: number;

    beforeEach(async () => {
      const HOLDER = "0xB1Fb33bF3A036742FFFAa9F96C548AcB0aE6a4bB";
      await unlockAccounts([HOLDER]);
      holder = await ethers.getSigner(HOLDER);
      await mockETHBalance(HOLDER, ethers.parseEther("100"));

      // open short position with 4x leverage
      position = await openOrAdd(
        fxUSD as any,
        holder,
        ethers.parseEther("10000"),
        { encoding: 0n, routes: [] },
        4n,
        30n,
        0
      );
    });

    it("should succeed when close position to fxUSD", async () => {
      // remove to make 3x leverage
      await closeOrRemove(
        fxUSD as any,
        holder,
        ethers.parseEther("20000"),
        { encoding: 0n, routes: [] },
        3,
        30n,
        position
      );

      // close entire position
      await closeOrRemove(
        fxUSD as any,
        holder,
        ethers.parseEther("20000"),
        { encoding: 0n, routes: [] },
        0,
        30n,
        position
      );
    });

    it("should succeed when close position to USDC", async () => {
      const USDC = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, holder);
      // remove to make 3x leverage
      await closeOrRemove(
        USDC,
        holder,
        ethers.parseEther("20000"),
        MULTI_PATH_CONVERTER_ROUTES.fxUSD.USDC,
        3,
        30n,
        position
      );

      // close entire position
      await closeOrRemove(
        USDC,
        holder,
        ethers.parseEther("20000"),
        MULTI_PATH_CONVERTER_ROUTES.fxUSD.USDC,
        0,
        30n,
        position
      );
    });
  });
});
