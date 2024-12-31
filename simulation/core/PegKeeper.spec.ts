import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
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
  AaveFundingPool,
  MockPriceOracle,
  MockRateProvider,
  MockAggregatorV3Interface,
} from "@/types/index";

import { forkNetworkAndUnlockAccounts, mockETHBalance } from "@/test/utils";
import { Addresses } from "@/utils/address";
import { encodeChainlinkPriceFeed, EthereumTokens, MULTI_PATH_CONVERTER_ROUTES } from "@/utils/index";
import { AbiCoder, id, MaxUint256 } from "ethers";

const FORK_HEIGHT = 21234850;
const FORK_URL = process.env.MAINNET_FORK_RPC || "";
const PLATFORM = "0x0084C2e1B1823564e597Ff4848a88D61ac63D703";
const OWNER = "0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF";
const DEPLOYER = "0x1000000000000000000000000000000000000001";

const wstETH_HOLDER = "0x3c22ec75ea5D745c78fc84762F7F1E6D82a2c5BF";
const USDC_HOLDER = "0x8EB8a3b98659Cce290402893d0123abb75E3ab28";

const TokenRate = ethers.parseEther("1.23");

describe("PegKeeper.spec", async () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let wstETHHolder: HardhatEthersSigner;
  let usdcHolder: HardhatEthersSigner;

  let proxyAdmin: ProxyAdmin;

  let fxUSD: FxUSDRegeneracy;
  let usdc: MockERC20;
  let wstETH: MockERC20;

  let oracle: MockPriceOracle;
  let rateProvider: MockRateProvider;
  let mockAggregatorV3Interface: MockAggregatorV3Interface;

  let pegKeeper: PegKeeper;
  let poolManager: PoolManager;
  let reservePool: ReservePool;
  let fxBASE: FxUSDBasePool;
  let pool: AaveFundingPool;

  let converter: MultiPathConverter;

  beforeEach(async () => {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [DEPLOYER, OWNER, wstETH_HOLDER, USDC_HOLDER]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    await mockETHBalance(OWNER, ethers.parseEther("100"));
    await mockETHBalance(wstETH_HOLDER, ethers.parseEther("100"));
    await mockETHBalance(USDC_HOLDER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);
    owner = await ethers.getSigner(OWNER);
    wstETHHolder = await ethers.getSigner(wstETH_HOLDER);
    usdcHolder = await ethers.getSigner(USDC_HOLDER);

    const MockAggregatorV3Interface = await ethers.getContractFactory("MockAggregatorV3Interface", deployer);
    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle", deployer);
    const MockRateProvider = await ethers.getContractFactory("MockRateProvider", deployer);
    mockAggregatorV3Interface = await MockAggregatorV3Interface.deploy(8, ethers.parseUnits("1", 8));
    oracle = await MockPriceOracle.deploy(
      ethers.parseEther("3000"),
      ethers.parseEther("2999"),
      ethers.parseEther("3001")
    );
    rateProvider = await MockRateProvider.deploy(TokenRate);

    proxyAdmin = await ethers.getContractAt("ProxyAdmin", "0x9B54B7703551D9d0ced177A78367560a8B2eDDA4", owner);
    fxUSD = await ethers.getContractAt("FxUSDRegeneracy", EthereumTokens.fxUSD.address, deployer);
    usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, deployer);
    wstETH = await ethers.getContractAt("MockERC20", EthereumTokens.wstETH.address, deployer);

    const EmptyContract = await ethers.getContractFactory("EmptyContract", deployer);
    const TransparentUpgradeableProxy = await ethers.getContractFactory("TransparentUpgradeableProxy", deployer);
    const FxUSDRegeneracy = await ethers.getContractFactory("FxUSDRegeneracy", deployer);
    const PegKeeper = await ethers.getContractFactory("PegKeeper", deployer);
    const PoolManager = await ethers.getContractFactory("PoolManager", deployer);
    const FxUSDBasePool = await ethers.getContractFactory("FxUSDBasePool", deployer);
    const ReservePool = await ethers.getContractFactory("ReservePool", deployer);
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
      encodeChainlinkPriceFeed(await mockAggregatorV3Interface.getAddress(), 10n ** 10n, 1000000000)
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

    // initialization
    await poolManager
      .connect(owner)
      .registerPool(
        pool.getAddress(),
        deployer.address,
        ethers.parseUnits("10000", 18),
        ethers.parseEther("100000000")
      );
    await poolManager.connect(owner).updateRateProvider(wstETH.getAddress(), rateProvider.getAddress());
    await poolManager.connect(owner).grantRole(id("OPERATOR_ROLE"), wstETHHolder.getAddress());
  });

  context("buyback", async () => {
    beforeEach(async () => {
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.991", 8));
      await pool.connect(owner).updateOpenRatio(0n, ethers.parseEther("1"));
      await wstETH.connect(wstETHHolder).approve(poolManager.getAddress(), MaxUint256);
      await poolManager
        .connect(wstETHHolder)
        .operate(pool.getAddress(), 0, ethers.parseEther("0.1"), ethers.parseEther("220"));
      await poolManager
        .connect(wstETHHolder)
        .operate(pool.getAddress(), 0, ethers.parseEther("1"), ethers.parseEther("2200"));
      await poolManager
        .connect(wstETHHolder)
        .operate(pool.getAddress(), 0, ethers.parseEther("10"), ethers.parseEther("22000"));
      expect(await pool.getNextTreeNodeId()).to.eq(2);
      expect(await pool.getTopTick()).to.eq(4997);

      // deposit stable to fxBase
      await usdc.connect(usdcHolder).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(usdcHolder).deposit(usdcHolder.address, usdc.getAddress(), ethers.parseUnits("5000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      // 3986.938775510204081632 fxUSD = 4023.147100 stable
      await oracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await fxBASE
        .connect(usdcHolder)
        ["rebalance(address,int16,address,uint256,uint256)"](
          pool.getAddress(),
          4997,
          usdc.getAddress(),
          ethers.parseUnits("5000"),
          0n
        );
      await pegKeeper.connect(owner).grantRole(id("BUYBACK_ROLE"), deployer.address);
    });

    const buyback = async (amountStable: bigint, amountFxUSD: bigint) => {
      expect(await usdc.balanceOf(fxUSD)).to.eq(ethers.parseUnits("4023.147100", 6));
      expect((await fxUSD.totalSupply()) - (await fxUSD.legacyTotalSupply())).to.eq(ethers.parseEther("24420"));
      expect(await fxUSD.stableReserve()).to.deep.eq([
        ethers.parseUnits("4023.147100", 6),
        ethers.parseEther("3986.938775510204081632"),
        6n,
      ]);
      const routeUSDCToFxUSD = MULTI_PATH_CONVERTER_ROUTES.USDC.fxUSD;
      const amountOut = await converter.queryConvert.staticCall(
        amountStable,
        routeUSDCToFxUSD.encoding,
        routeUSDCToFxUSD.routes
      );
      const slippage = 30n;

      await expect(
        pegKeeper
          .connect(deployer)
          .buyback(
            amountStable,
            AbiCoder.defaultAbiCoder().encode(
              ["uint256", "uint256", "uint256[]"],
              [amountOut * 2n, routeUSDCToFxUSD.encoding, routeUSDCToFxUSD.routes]
            )
          )
      ).to.revertedWithCustomError(pegKeeper, "ErrorInsufficientOutput");
      const callerBefore = await fxUSD.balanceOf(deployer.address);
      await expect(
        pegKeeper
          .connect(deployer)
          .buyback(
            amountStable,
            AbiCoder.defaultAbiCoder().encode(
              ["uint256", "uint256", "uint256[]"],
              [(amountOut * (10000n - slippage)) / 10000n, routeUSDCToFxUSD.encoding, routeUSDCToFxUSD.routes]
            )
          )
      ).to.emit(fxUSD, "Buyback");
      const callerAfter = await fxUSD.balanceOf(deployer.address);
      expect(await fxUSD.stableReserve()).to.deep.eq([
        ethers.parseUnits("4023.147100", 6) - amountStable,
        ethers.parseEther("3986.938775510204081632") - amountFxUSD,
        6n,
      ]);
      expect(await usdc.balanceOf(fxUSD)).to.eq(ethers.parseUnits("4023.147100", 6) - amountStable);
      expect((await fxUSD.totalSupply()) - (await fxUSD.legacyTotalSupply())).to.eq(
        ethers.parseEther("24420") - amountFxUSD
      );
      expect(callerAfter - callerBefore).to.closeTo(amountOut - amountFxUSD, 100000n);
      console.log(
        "BuyBack:",
        `USDC[${ethers.formatUnits(amountStable, 6)}]`,
        `fxUSD[${ethers.formatEther(amountFxUSD)}]`,
        `bonus[${ethers.formatEther(callerAfter - callerBefore)}]`
      );
    };

    it("should ok, buyback partial", async () => {
      await buyback(ethers.parseUnits("1000", 6), ethers.parseEther("990.999999853399365296"));
    });

    it("should ok, buyback full", async () => {
      await buyback(ethers.parseUnits("4023.147100", 6), ethers.parseEther("3986.938775510204081632"));
    });
  });

  context("stabilize", async () => {
    beforeEach(async () => {
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.991", 8));
      await pool.connect(owner).updateOpenRatio(0n, ethers.parseEther("1"));
      await wstETH.connect(wstETHHolder).approve(poolManager.getAddress(), MaxUint256);
      await poolManager
        .connect(wstETHHolder)
        .operate(pool.getAddress(), 0, ethers.parseEther("0.1"), ethers.parseEther("220"));
      await poolManager
        .connect(wstETHHolder)
        .operate(pool.getAddress(), 0, ethers.parseEther("1"), ethers.parseEther("2200"));
      await poolManager
        .connect(wstETHHolder)
        .operate(pool.getAddress(), 0, ethers.parseEther("10"), ethers.parseEther("22000"));
      expect(await pool.getNextTreeNodeId()).to.eq(2);
      expect(await pool.getTopTick()).to.eq(4997);

      // deposit fxUSD to fxBase
      await fxUSD.connect(wstETHHolder).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE
        .connect(wstETHHolder)
        .deposit(wstETHHolder.address, fxUSD.getAddress(), ethers.parseEther("5000"), 0n);

      // deposit stable to fxBase
      await usdc.connect(usdcHolder).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(usdcHolder).deposit(usdcHolder.address, usdc.getAddress(), ethers.parseUnits("5000", 6), 0n);

      await pegKeeper.connect(owner).grantRole(id("STABILIZE_ROLE"), deployer.address);
    });

    it("should succeed, when swap USDC to fxUSD", async () => {
      // 1 fxUSD => 1.009082 stable, 1 stable => 0.991 fxUSD
      // swap 1000 USDC to fxUSD
      const amountStable = ethers.parseUnits("1000", 6);
      const amountFxUSD = ethers.parseEther("991");
      const routeUSDCToFxUSD = MULTI_PATH_CONVERTER_ROUTES.USDC.fxUSD;
      const amountOut = await converter.queryConvert.staticCall(
        amountStable,
        routeUSDCToFxUSD.encoding,
        routeUSDCToFxUSD.routes
      );
      const slippage = 30n;

      await expect(
        pegKeeper
          .connect(deployer)
          .stabilize(
            usdc.getAddress(),
            amountStable,
            AbiCoder.defaultAbiCoder().encode(
              ["uint256", "uint256", "uint256[]"],
              [amountOut * 2n, routeUSDCToFxUSD.encoding, routeUSDCToFxUSD.routes]
            )
          )
      ).to.revertedWithCustomError(pegKeeper, "ErrorInsufficientOutput");

      const totalYieldBefore = await fxBASE.totalYieldToken();
      const totalStableBefore = await fxBASE.totalStableToken();
      const fxusdBalanceBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const usdcBalanceBefore = await usdc.balanceOf(fxBASE.getAddress());
      const callerFxUSDBalanceBefore = await fxUSD.balanceOf(deployer.getAddress());
      await expect(
        pegKeeper
          .connect(deployer)
          .stabilize(
            usdc.getAddress(),
            amountStable,
            AbiCoder.defaultAbiCoder().encode(
              ["uint256", "uint256", "uint256[]"],
              [(amountOut * (10000n - slippage)) / 10000n, routeUSDCToFxUSD.encoding, routeUSDCToFxUSD.routes]
            )
          )
      ).to.emit(fxBASE, "Arbitrage");
      const totalYieldAfter = await fxBASE.totalYieldToken();
      const totalStableAfter = await fxBASE.totalStableToken();
      const fxusdBalanceAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const usdcBalanceAfter = await usdc.balanceOf(fxBASE.getAddress());
      const callerFxUSDBalanceAfter = await fxUSD.balanceOf(deployer.getAddress());
      expect(totalYieldAfter).to.eq(fxusdBalanceAfter);
      expect(totalStableAfter).to.eq(usdcBalanceAfter);
      expect(totalYieldAfter - totalYieldBefore).to.eq(amountFxUSD);
      expect(totalStableAfter - totalStableBefore).to.eq(-amountStable);
      expect(fxusdBalanceAfter - fxusdBalanceBefore).to.eq(amountFxUSD);
      expect(usdcBalanceAfter - usdcBalanceBefore).to.eq(-amountStable);
      console.log(
        "BuyBack:",
        `USDC[${ethers.formatUnits(amountStable, 6)}]`,
        `fxUSD[${ethers.formatEther(amountFxUSD)}]`,
        `bonus[${ethers.formatEther(callerFxUSDBalanceAfter - callerFxUSDBalanceBefore)}]`
      );
    });
  });
});
