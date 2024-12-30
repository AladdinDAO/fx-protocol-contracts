import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  AaveFundingPool,
  Diamond,
  FxUSDRegeneracy,
  FxUSDBasePool,
  FxUSDBasePool__factory,
  MarketV2,
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
} from "@/types/index";

import { forkNetworkAndUnlockAccounts, mockETHBalance, unlockAccounts } from "@/test/utils";
import { Addresses } from "@/utils/address";
import {
  ChainlinkPriceFeed,
  encodeChainlinkPriceFeed,
  encodeSpotPriceSources,
  EthereumTokens,
  MULTI_PATH_CONVERTER_ROUTES,
  SpotPriceEncodings,
} from "@/utils/index";
import { id, Interface, ZeroAddress } from "ethers";

const FORK_HEIGHT = 21234850;
const FORK_URL = process.env.MAINNET_FORK_RPC || "";
const PLATFORM = "0x0084C2e1B1823564e597Ff4848a88D61ac63D703";
const OWNER = "0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF";
const DEPLOYER = "0x1000000000000000000000000000000000000001";

const getAllSignatures = (e: Interface): string[] => {
  const sigs: string[] = [];
  e.forEachFunction((func, _) => {
    sigs.push(func.selector);
  });
  return sigs;
};

describe("MigrateFacet.spec", async () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;

  let proxyAdmin: ProxyAdmin;

  let fxUSD: FxUSDRegeneracy;
  let usdc: MockERC20;
  let wstETH: MockERC20;
  let sfrxETH: MockERC20;

  let oracle: StETHPriceOracle;

  let wstETHMarket: MarketV2;
  let sfrxETHMarket: MarketV2;
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

    wstETHMarket = await ethers.getContractAt("MarketV2", "0xAD9A0E7C08bc9F747dF97a3E7E7f620632CB6155", deployer);
    sfrxETHMarket = await ethers.getContractAt("MarketV2", "0x714B853b3bA73E439c652CfE79660F329E6ebB42", deployer);
    fxUSD = await ethers.getContractAt("FxUSDRegeneracy", EthereumTokens.fxUSD.address, deployer);
    usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, deployer);
    wstETH = await ethers.getContractAt("MockERC20", EthereumTokens.wstETH.address, deployer);
    sfrxETH = await ethers.getContractAt("MockERC20", EthereumTokens.sfrxETH.address, deployer);

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
    await pool.updateDebtRatioRange(0n, ethers.parseEther("0.8"));
    await pool.updateRebalanceRatios(ethers.parseEther("0.88"), ethers.parseUnits("0.025", 9));
    await pool.updateLiquidateRatios(ethers.parseEther("0.92"), ethers.parseUnits("0.05", 9));

    // GaugeRewarder
    rewarder = await GaugeRewarder.deploy(fxBASE.getAddress());

    // deploy MarketV2
    const MarketV2 = await ethers.getContractFactory("MarketV2", deployer);
    const WstETHMarketV2Impl = await MarketV2.deploy("0xED803540037B0ae069c93420F89Cd653B6e3Df1f");
    const SfrxETHMarketV2Impl = await MarketV2.deploy("0xcfEEfF214b256063110d3236ea12Db49d2dF2359");
    await proxyAdmin.upgrade(wstETHMarket.getAddress(), WstETHMarketV2Impl.getAddress());
    await proxyAdmin.upgrade(sfrxETHMarket.getAddress(), SfrxETHMarketV2Impl.getAddress());

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
      await manager.connect(owner).updateRevenuePool(PLATFORM);
    }

    // initialization
    await wstETHMarket.connect(owner).grantRole(await wstETHMarket.MIGRATOR_ROLE(), router.getAddress());
    await sfrxETHMarket.connect(owner).grantRole(await wstETHMarket.MIGRATOR_ROLE(), router.getAddress());
    await fxUSD.connect(owner).grantRole(await fxUSD.MIGRATOR_ROLE(), router.getAddress());
    await poolManager
      .connect(owner)
      .registerPool(
        pool.getAddress(),
        rewarder.getAddress(),
        ethers.parseUnits("10000", 18),
        ethers.parseEther("100000000")
      );
    await poolManager
      .connect(owner)
      .updateRateProvider(wstETH.getAddress(), "0x81A777c4aB65229d1Bf64DaE4c831bDf628Ccc7f");
    await poolManager.connect(owner).grantRole(id("OPERATOR_ROLE"), router.getAddress());
  });

  const encodeMiscData = (minDebtRatio: bigint, maxDebtRatio: bigint): bigint => {
    return (maxDebtRatio << 60n) + minDebtRatio;
  };

  const migrateXstETH = async (
    holder: HardhatEthersSigner,
    positionId: number,
    amountXToken: bigint
  ): Promise<number> => {
    const xstETH = await ethers.getContractAt("MockERC20", EthereumTokens.xstETH.address, holder);
    const fstETH = await ethers.getContractAt("MockERC20", EthereumTokens.fstETH.address, holder);
    const usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, holder);

    const facet = await ethers.getContractAt("MigrateFacet", await router.getAddress(), deployer);

    const curvePool = await ethers.getContractAt("ICurveStableSwapNG", Addresses["CRV_SN_USDC/fxUSD_193"], holder);
    const routeUSDCToFxUSD = MULTI_PATH_CONVERTER_ROUTES.USDC.fxUSD;
    const routeFxUSDToUSDC = MULTI_PATH_CONVERTER_ROUTES.fxUSD.USDC;
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256[]", "uint256", "uint256[]"],
      [
        encodeMiscData(ethers.parseEther("0.01"), ethers.parseEther("0.9")),
        routeUSDCToFxUSD.encoding,
        routeUSDCToFxUSD.routes,
        routeFxUSDToUSDC.encoding,
        routeFxUSDToUSDC.routes,
      ]
    );

    // compute borrow amount
    const amountFToken = (amountXToken * (await fstETH.totalSupply())) / (await xstETH.totalSupply());
    // add 0.1% to cover slippage
    const amountUSDC = ((await curvePool.get_dx(0, 1, amountFToken)) * 1001n) / 1000n;
    console.log("fxUSD to redeem:", ethers.formatEther(amountFToken));
    console.log("USDC to borrow:", ethers.formatUnits(amountUSDC, 6));

    const usdcBefore = await usdc.balanceOf(PLATFORM);
    const xstETHBefore = await xstETH.balanceOf(holder.address);
    // approve nft tx
    if (positionId > 0) {
      await pool.connect(holder).approve(router.getAddress(), positionId);
    }
    // approve xstETH tx
    await xstETH.connect(holder).approve(router.getAddress(), amountXToken);
    // migrate tx
    const tx = await facet
      .connect(holder)
      .migrateXstETHPosition(pool.getAddress(), positionId, amountXToken, amountUSDC, data);
    const r = await tx.wait();
    const usdcAfter = await usdc.balanceOf(PLATFORM);
    const xstETHAfter = await xstETH.balanceOf(holder.address);
    expect(xstETHBefore - xstETHAfter).to.eq(amountXToken);
    if (positionId === 0) {
      positionId = Number((await pool.getNextPositionId()) - 1n);
    }
    expect(await pool.ownerOf(positionId)).to.eq(holder.address);
    console.log("gas used:", r?.gasUsed);
    console.log("USDC leftover", ethers.formatUnits(usdcAfter - usdcBefore, 6));
    console.log(
      "price impact",
      ethers.formatEther(((usdcAfter - usdcBefore) * 10n ** 12n * 10n ** 18n) / amountFToken)
    );
    const [colls, debts] = await pool.getPosition(positionId);
    console.log(
      `colls[${ethers.formatEther(colls)}] debts[${ethers.formatEther(debts)}] debt ratio:`,
      ethers.formatEther(await pool.getPositionDebtRatio(positionId))
    );
    return positionId;
  };

  const migrateXfrxETH = async (
    holder: HardhatEthersSigner,
    positionId: number,
    amountXToken: bigint
  ): Promise<number> => {
    const xfrxETH = await ethers.getContractAt("MockERC20", EthereumTokens.xfrxETH.address, holder);
    const ffrxETH = await ethers.getContractAt("MockERC20", EthereumTokens.ffrxETH.address, holder);
    const usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, holder);

    const facet = await ethers.getContractAt("MigrateFacet", await router.getAddress(), deployer);

    const curvePool = await ethers.getContractAt("ICurveStableSwapNG", Addresses["CRV_SN_USDC/fxUSD_193"], holder);
    const routeUSDCToFxUSD = MULTI_PATH_CONVERTER_ROUTES.USDC.fxUSD;
    const routeFxUSDToUSDC = MULTI_PATH_CONVERTER_ROUTES.fxUSD.USDC;
    const routeSfrxETHToWstETH = MULTI_PATH_CONVERTER_ROUTES.sfrxETH.wstETH;
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256[]", "uint256", "uint256[]", "uint256", "uint256[]"],
      [
        encodeMiscData(ethers.parseEther("0.01"), ethers.parseEther("0.9")),
        routeUSDCToFxUSD.encoding,
        routeUSDCToFxUSD.routes,
        routeFxUSDToUSDC.encoding,
        routeFxUSDToUSDC.routes,
        routeSfrxETHToWstETH.encoding,
        routeSfrxETHToWstETH.routes,
      ]
    );

    // compute borrow amount
    const amountFToken = (amountXToken * (await ffrxETH.totalSupply())) / (await xfrxETH.totalSupply());
    // add 0.1% to cover slippage
    const amountUSDC = ((await curvePool.get_dx(0, 1, amountFToken)) * 1001n) / 1000n;
    console.log("fxUSD to redeem:", ethers.formatEther(amountFToken));
    console.log("USDC to borrow:", ethers.formatUnits(amountUSDC, 6));

    const usdcBefore = await usdc.balanceOf(PLATFORM);
    const xfrxETHBefore = await xfrxETH.balanceOf(holder.address);
    // approve nft tx
    if (positionId > 0) {
      await pool.connect(holder).approve(router.getAddress(), positionId);
    }
    // approve xfrxETH tx
    await xfrxETH.connect(holder).approve(router.getAddress(), amountXToken);
    // migrate tx
    const tx = await facet
      .connect(holder)
      .migrateXfrxETHPosition(pool.getAddress(), positionId, amountXToken, amountUSDC, data);
    const r = await tx.wait();
    const usdcAfter = await usdc.balanceOf(PLATFORM);
    const xfrxETHAfter = await xfrxETH.balanceOf(holder.address);
    expect(xfrxETHBefore - xfrxETHAfter).to.eq(amountXToken);
    if (positionId === 0) {
      positionId = Number((await pool.getNextPositionId()) - 1n);
    }
    expect(await pool.ownerOf(positionId)).to.eq(holder.address);
    console.log("gas used:", r?.gasUsed);
    console.log("USDC leftover", ethers.formatUnits(usdcAfter - usdcBefore, 6));
    console.log(
      "price impact",
      ethers.formatEther(((usdcAfter - usdcBefore) * 10n ** 12n * 10n ** 18n) / amountFToken)
    );
    const [colls, debts] = await pool.getPosition(positionId);
    console.log(
      `colls[${ethers.formatEther(colls)}] debts[${ethers.formatEther(debts)}] debt ratio:`,
      ethers.formatEther(await pool.getPositionDebtRatio(positionId))
    );
    return positionId;
  };

  it("should succeed, when migrate xstETH to position", async () => {
    const HOLDER = "0x488b99c4A94BB0027791E8e0eEB421187EC9a487";
    await unlockAccounts([HOLDER]);
    const holder = await ethers.getSigner(HOLDER);
    await mockETHBalance(HOLDER, ethers.parseEther("100"));

    // first time migrate 1000000 xstETH
    const positionId = await migrateXstETH(holder, 0, ethers.parseEther("1000000"));
    // second time migrate 1000000 xstETH
    await migrateXstETH(holder, positionId, ethers.parseEther("2000000"));
    // third time migrate 1000000 xstETH
    await migrateXstETH(holder, positionId, ethers.parseEther("2000000"));
  });

  it("should succeed, when migrate xfrxETH to position", async () => {
    const HOLDER = "0xF968A5de2019dE1F0A8f53758dD137aE5C9EFbC9";
    await unlockAccounts([HOLDER]);
    const holder = await ethers.getSigner(HOLDER);
    await mockETHBalance(HOLDER, ethers.parseEther("100"));

    // first time migrate 100000 xfrxETH
    const positionId = await migrateXfrxETH(holder, 0, ethers.parseEther("100000"));
    // second time migrate 200000 xfrxETH
    await migrateXfrxETH(holder, positionId, ethers.parseEther("200000"));
    // third time migrate 200000 xfrxETH
    await migrateXfrxETH(holder, positionId, ethers.parseEther("200000"));
  });
});
