/* eslint-disable camelcase */
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { AbiCoder, id, MaxUint256, ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import {
  AaveFundingPool,
  FxUSDRegeneracy,
  MockAaveV3Pool,
  MockAggregatorV3Interface,
  MockCurveStableSwapNG,
  MockERC20,
  MockPriceOracle,
  MockRateProvider,
  PegKeeper,
  PegKeeper__factory,
  PoolManager,
  PoolManager__factory,
  ProxyAdmin,
  ReservePool,
  GaugeRewarder,
  FxUSDBasePool,
  FxUSDBasePool__factory,
  MockMultiPathConverter,
} from "@/types/index";
import { encodeChainlinkPriceFeed } from "@/utils/index";
import { mockETHBalance, unlockAccounts } from "../utils";

const TokenRate = ethers.parseEther("1.23");

describe("FxUSDRegeneracy.spec", async () => {
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let revenuePool: HardhatEthersSigner;

  let proxyAdmin: ProxyAdmin;
  let fxUSD: FxUSDRegeneracy;
  let stableToken: MockERC20;
  let collateralToken: MockERC20;
  let pegKeeper: PegKeeper;
  let poolManager: PoolManager;
  let reservePool: ReservePool;
  let fxBASE: FxUSDBasePool;
  let rewarder: GaugeRewarder;

  let mockConverter: MockMultiPathConverter;
  let mockAggregatorV3Interface: MockAggregatorV3Interface;
  let mockCurveStableSwapNG: MockCurveStableSwapNG;
  let mockPriceOracle: MockPriceOracle;
  let mockRateProvider: MockRateProvider;
  let mockAaveV3Pool: MockAaveV3Pool;

  let pool: AaveFundingPool;

  beforeEach(async () => {
    [deployer, admin, treasury, revenuePool] = await ethers.getSigners();

    const MockAggregatorV3Interface = await ethers.getContractFactory("MockAggregatorV3Interface", deployer);
    const MockCurveStableSwapNG = await ethers.getContractFactory("MockCurveStableSwapNG", deployer);
    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle", deployer);
    const MockRateProvider = await ethers.getContractFactory("MockRateProvider", deployer);
    const MockAaveV3Pool = await ethers.getContractFactory("MockAaveV3Pool", deployer);

    mockAggregatorV3Interface = await MockAggregatorV3Interface.deploy(8, ethers.parseUnits("1", 8));
    mockCurveStableSwapNG = await MockCurveStableSwapNG.deploy();
    mockPriceOracle = await MockPriceOracle.deploy(
      ethers.parseEther("3000"),
      ethers.parseEther("2999"),
      ethers.parseEther("3001")
    );
    mockRateProvider = await MockRateProvider.deploy(TokenRate);
    mockAaveV3Pool = await MockAaveV3Pool.deploy(ethers.parseUnits("0.05", 27));

    const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
    const EmptyContract = await ethers.getContractFactory("EmptyContract", deployer);
    const TransparentUpgradeableProxy = await ethers.getContractFactory("TransparentUpgradeableProxy", deployer);
    const ProxyAdmin = await ethers.getContractFactory("ProxyAdmin", deployer);
    const FxUSDRegeneracy = await ethers.getContractFactory("FxUSDRegeneracy", deployer);
    const PegKeeper = await ethers.getContractFactory("PegKeeper", deployer);
    const PoolManager = await ethers.getContractFactory("PoolManager", deployer);
    const FxUSDBasePool = await ethers.getContractFactory("FxUSDBasePool", deployer);
    const ReservePool = await ethers.getContractFactory("ReservePool", deployer);
    const GaugeRewarder = await ethers.getContractFactory("GaugeRewarder", deployer);
    const MockMultiPathConverter = await ethers.getContractFactory("MockMultiPathConverter", deployer);

    const empty = await EmptyContract.deploy();
    stableToken = await MockERC20.deploy("USDC", "USDC", 6);
    collateralToken = await MockERC20.deploy("X", "Y", 18);
    proxyAdmin = await ProxyAdmin.connect(admin).deploy();
    mockConverter = await MockMultiPathConverter.deploy();

    const FxUSDRegeneracyProxy = await TransparentUpgradeableProxy.deploy(
      empty.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );
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
    reservePool = await ReservePool.deploy(admin.address, PoolManagerProxy.getAddress());

    // deploy PoolManager
    const PoolManagerImpl = await PoolManager.deploy(
      FxUSDRegeneracyProxy.getAddress(),
      FxUSDBasePoolProxy.getAddress(),
      PegKeeperProxy.getAddress()
    );
    await proxyAdmin.upgradeAndCall(
      PoolManagerProxy.getAddress(),
      PoolManagerImpl.getAddress(),
      PoolManager__factory.createInterface().encodeFunctionData("initialize", [
        admin.address,
        ethers.parseUnits("0.1", 9),
        ethers.parseUnits("0.01", 9),
        ethers.parseUnits("0.0001", 9),
        treasury.address,
        revenuePool.address,
        await reservePool.getAddress(),
      ])
    );
    poolManager = await ethers.getContractAt("PoolManager", await PoolManagerProxy.getAddress(), admin);

    // deploy FxUSDRegeneracy
    const FxUSDRegeneracyImpl = await FxUSDRegeneracy.deploy(
      PoolManagerProxy.getAddress(),
      stableToken.getAddress(),
      PegKeeperProxy.getAddress()
    );
    await proxyAdmin.upgrade(FxUSDRegeneracyProxy.getAddress(), FxUSDRegeneracyImpl.getAddress());
    fxUSD = await ethers.getContractAt("FxUSDRegeneracy", await FxUSDRegeneracyProxy.getAddress(), admin);
    await fxUSD.initialize("f(x) USD", "fxUSD");
    await fxUSD.initializeV2();

    // deploy FxUSDBasePool
    const FxUSDBasePoolImpl = await FxUSDBasePool.deploy(
      PoolManagerProxy.getAddress(),
      PegKeeperProxy.getAddress(),
      FxUSDRegeneracyProxy.getAddress(),
      stableToken.getAddress(),
      encodeChainlinkPriceFeed(await mockAggregatorV3Interface.getAddress(), 10n ** 10n, 1000000000)
    );
    await proxyAdmin.upgradeAndCall(
      FxUSDBasePoolProxy.getAddress(),
      FxUSDBasePoolImpl.getAddress(),
      FxUSDBasePool__factory.createInterface().encodeFunctionData("initialize", [
        admin.address,
        "Staked f(x) USD",
        "fxBASE",
        ethers.parseEther("0.95"),
        0n,
      ])
    );
    fxBASE = await ethers.getContractAt("FxUSDBasePool", await FxUSDBasePoolProxy.getAddress(), admin);

    // deploy PegKeeper
    const PegKeeperImpl = await PegKeeper.deploy(fxBASE.getAddress());
    await proxyAdmin.upgradeAndCall(
      PegKeeperProxy.getAddress(),
      PegKeeperImpl.getAddress(),
      PegKeeper__factory.createInterface().encodeFunctionData("initialize", [
        admin.address,
        await mockConverter.getAddress(),
        await mockCurveStableSwapNG.getAddress(),
      ])
    );
    pegKeeper = await ethers.getContractAt("PegKeeper", await PegKeeperProxy.getAddress(), admin);

    // deploy AaveFundingPool
    const AaveFundingPool = await ethers.getContractFactory("AaveFundingPool", admin);
    pool = await AaveFundingPool.deploy(
      poolManager.getAddress(),
      mockAaveV3Pool.getAddress(),
      stableToken.getAddress()
    );
    await pool.initialize(
      admin.address,
      "f(x) wstETH position",
      "xstETH",
      collateralToken.getAddress(),
      mockPriceOracle.getAddress()
    );
    await pool.updateRebalanceRatios(ethers.parseEther("0.88"), ethers.parseUnits("0.025", 9));
    await pool.updateLiquidateRatios(ethers.parseEther("0.92"), ethers.parseUnits("0.05", 9));

    rewarder = await GaugeRewarder.deploy(fxBASE.getAddress());
    await poolManager.registerPool(
      pool.getAddress(),
      rewarder.getAddress(),
      ethers.parseUnits("10000", 18),
      ethers.parseEther("10000000")
    );
    await poolManager.updateRateProvider(collateralToken.getAddress(), mockRateProvider.getAddress());
    await mockCurveStableSwapNG.setCoin(0, stableToken.getAddress());
    await mockCurveStableSwapNG.setCoin(1, fxUSD.getAddress());
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("1"));
  });

  context("constructor", async () => {
    it("should succeed", async () => {
      expect(await fxUSD.name()).to.eq("f(x) USD");
      expect(await fxUSD.symbol()).to.eq("fxUSD");
      expect(await fxUSD.MIGRATOR_ROLE()).to.eq(id("MIGRATOR_ROLE"));

      expect(await fxUSD.poolManager()).to.eq(await poolManager.getAddress());
      expect(await fxUSD.pegKeeper()).to.eq(await pegKeeper.getAddress());
      expect(await fxUSD.stableToken()).to.eq(await stableToken.getAddress());

      expect(await fxUSD.legacyTotalSupply()).to.eq(0n);
      expect(await fxUSD.stableReserve()).to.deep.eq([0n, 0n, 6n]);
    });

    it("should revert, when initialize again", async () => {
      await expect(fxUSD.initializeV2()).to.revertedWith("Initializable: contract is already initialized");
    });
  });

  context("unwrap", async () => {
    it("should revert, when caller is not MIGRATOR_ROLE", async () => {
      await expect(fxUSD.connect(deployer).unwrap(ZeroAddress, 0n, ZeroAddress)).to.revertedWith(
        "AccessControl: account " + deployer.address.toLowerCase() + " is missing role " + id("MIGRATOR_ROLE")
      );
    });
  });

  context("mint", async () => {
    it("should revert, when caller is not pool manager", async () => {
      await expect(fxUSD["mint(address,uint256)"](ZeroAddress, 0n)).to.revertedWithCustomError(
        fxUSD,
        "ErrorCallerNotPoolManager"
      );
    });

    it("should succeed", async () => {
      await unlockAccounts([await poolManager.getAddress()]);
      const signer = await ethers.getSigner(await poolManager.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));

      expect(await fxUSD.balanceOf(deployer.address)).to.eq(0n);
      expect(await fxUSD.totalSupply()).to.eq(0n);
      expect(await fxUSD.legacyTotalSupply()).to.eq(0n);
      await expect(fxUSD.connect(signer)["mint(address,uint256)"](deployer.address, ethers.parseEther("1")))
        .to.emit(fxUSD, "Transfer")
        .withArgs(ZeroAddress, deployer.address, ethers.parseEther("1"));
      expect(await fxUSD.balanceOf(deployer.address)).to.eq(ethers.parseEther("1"));
      expect(await fxUSD.totalSupply()).to.eq(ethers.parseEther("1"));
      expect(await fxUSD.legacyTotalSupply()).to.eq(0n);
    });
  });

  context("burn", async () => {
    it("should revert, when caller is not pool manager", async () => {
      await expect(fxUSD.burn(ZeroAddress, 0n)).to.revertedWithCustomError(fxUSD, "ErrorCallerNotPoolManager");
    });

    it("should succeed", async () => {
      await unlockAccounts([await poolManager.getAddress()]);
      const signer = await ethers.getSigner(await poolManager.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));

      expect(await fxUSD.balanceOf(deployer.address)).to.eq(0n);
      expect(await fxUSD.totalSupply()).to.eq(0n);
      expect(await fxUSD.legacyTotalSupply()).to.eq(0n);
      await expect(fxUSD.connect(signer)["mint(address,uint256)"](deployer.address, ethers.parseEther("1")))
        .to.emit(fxUSD, "Transfer")
        .withArgs(ZeroAddress, deployer.address, ethers.parseEther("1"));
      expect(await fxUSD.balanceOf(deployer.address)).to.eq(ethers.parseEther("1"));
      expect(await fxUSD.totalSupply()).to.eq(ethers.parseEther("1"));
      expect(await fxUSD.legacyTotalSupply()).to.eq(0n);

      await expect(fxUSD.connect(signer).burn(deployer.address, ethers.parseEther("0.2")))
        .to.emit(fxUSD, "Transfer")
        .withArgs(deployer.address, ZeroAddress, ethers.parseEther("0.2"));
      expect(await fxUSD.balanceOf(deployer.address)).to.eq(ethers.parseEther("0.8"));
      expect(await fxUSD.totalSupply()).to.eq(ethers.parseEther("0.8"));
      expect(await fxUSD.legacyTotalSupply()).to.eq(0n);
    });
  });

  context("onRebalanceWithStable", async () => {
    it("should revert, when caller is not pool manager", async () => {
      await expect(fxUSD.onRebalanceWithStable(0n, 0n)).to.revertedWithCustomError(fxUSD, "ErrorCallerNotPoolManager");
    });

    it("should succeed", async () => {
      await unlockAccounts([await poolManager.getAddress()]);
      const signer = await ethers.getSigner(await poolManager.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));

      expect(await fxUSD.stableReserve()).to.deep.eq([0n, 0n, 6n]);
      await expect(fxUSD.connect(signer).onRebalanceWithStable(ethers.parseUnits("1000", 6), ethers.parseEther("1000")))
        .to.emit(fxUSD, "RebalanceWithStable")
        .withArgs(ethers.parseUnits("1000", 6), ethers.parseEther("1000"));
      expect(await fxUSD.stableReserve()).to.deep.eq([ethers.parseUnits("1000", 6), ethers.parseEther("1000"), 6n]);
    });
  });

  context("buyback", async () => {
    beforeEach(async () => {
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.991", 8));
      await stableToken.mint(deployer.address, ethers.parseUnits("220000", 6));
      await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
      await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

      await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);

      // open 3 positions on the same tick
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
      await poolManager
        .connect(deployer)
        .operate(pool.getAddress(), 0, ethers.parseEther("0.1"), ethers.parseEther("220"));
      await poolManager
        .connect(deployer)
        .operate(pool.getAddress(), 0, ethers.parseEther("1"), ethers.parseEther("2200"));
      await poolManager
        .connect(deployer)
        .operate(pool.getAddress(), 0, ethers.parseEther("10"), ethers.parseEther("22000"));
      expect(await pool.getNextTreeNodeId()).to.eq(2);
      expect(await pool.getTopTick()).to.eq(4997);

      // deposit stable to fxBase
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("5000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      // 3986.938775510204081632 fxUSD = 4023.147100 stable
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      expect(await stableToken.balanceOf(fxUSD)).to.eq(0n);
      expect(await fxUSD.totalSupply()).to.eq(ethers.parseEther("24420"));
      await fxBASE
        .connect(deployer)
        ["rebalance(address,int16,address,uint256,uint256)"](
          pool.getAddress(),
          4997,
          stableToken.getAddress(),
          ethers.parseUnits("5000"),
          0n
        );
      expect(await fxUSD.stableReserve()).to.deep.eq([
        ethers.parseUnits("4023.147100", 6),
        ethers.parseEther("3986.938775510204081632"),
        6n,
      ]);
      expect(await stableToken.balanceOf(fxUSD)).to.eq(ethers.parseUnits("4023.147100", 6));
      expect(await fxUSD.totalSupply()).to.eq(ethers.parseEther("24420"));

      await pegKeeper.connect(admin).grantRole(id("BUYBACK_ROLE"), deployer.address);
    });

    it("should revert, when caller not peg keeper", async () => {
      await expect(fxUSD.connect(deployer).buyback(0n, ZeroAddress, "0x")).to.revertedWithCustomError(
        fxUSD,
        "ErrorCallerNotPegKeeper"
      );
    });

    it("should revert, when ErrorExceedStableReserve", async () => {
      await unlockAccounts([await pegKeeper.getAddress()]);
      const signer = await ethers.getSigner(await pegKeeper.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));

      await expect(
        fxUSD.connect(signer).buyback(ethers.parseUnits("4023.147100", 6) + 1n, deployer.address, "0x")
      ).to.revertedWithCustomError(fxUSD, "ErrorExceedStableReserve");
    });

    it("should revert, when ErrorInsufficientBuyBack", async () => {
      // 3986.938775510204081632 fxUSD = 4023.147100 stable
      await mockConverter.setTokenOut(fxUSD.getAddress(), ethers.parseEther("3986.938775510204081632") - 1n);
      await fxUSD
        .connect(deployer)
        .transfer(mockConverter.getAddress(), ethers.parseEther("3986.938775510204081632") - 1n);
      await expect(
        pegKeeper
          .connect(deployer)
          .buyback(
            ethers.parseUnits("4023.147100", 6),
            AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256[]"], [0n, 0n, []])
          )
      ).to.revertedWithCustomError(fxUSD, "ErrorInsufficientBuyBack");
    });

    const buyback = async (amountStable: bigint, amountFxUSD: bigint, amountBonus: bigint) => {
      await mockConverter.setTokenOut(fxUSD.getAddress(), amountFxUSD + amountBonus);
      await fxUSD.connect(deployer).transfer(mockConverter.getAddress(), amountFxUSD + amountBonus);

      expect(await stableToken.balanceOf(fxUSD)).to.eq(ethers.parseUnits("4023.147100", 6));
      expect(await fxUSD.totalSupply()).to.eq(ethers.parseEther("24420"));
      expect(await fxUSD.stableReserve()).to.deep.eq([
        ethers.parseUnits("4023.147100", 6),
        ethers.parseEther("3986.938775510204081632"),
        6n,
      ]);
      const callerBefore = await fxUSD.balanceOf(deployer.address);
      await expect(
        pegKeeper
          .connect(deployer)
          .buyback(amountStable, AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256[]"], [0n, 0n, []]))
      )
        .to.emit(fxUSD, "Buyback")
        .withArgs(amountStable, amountFxUSD + amountBonus, amountBonus);
      const callerAfter = await fxUSD.balanceOf(deployer.address);
      expect(await fxUSD.stableReserve()).to.deep.eq([
        ethers.parseUnits("4023.147100", 6) - amountStable,
        ethers.parseEther("3986.938775510204081632") - amountFxUSD,
        6n,
      ]);
      expect(await stableToken.balanceOf(fxUSD)).to.eq(ethers.parseUnits("4023.147100", 6) - amountStable);
      expect(await fxUSD.totalSupply()).to.eq(ethers.parseEther("24420") - amountFxUSD);
      expect(callerAfter - callerBefore).to.eq(amountBonus);
    };

    it("should succeed, when partial buyback, no bonus", async () => {
      // 3986.938775510204081632 fxUSD = 4023.147100 stable
      // use 1000 stable, need 990.999999853399365296 fxUSD
      await buyback(ethers.parseUnits("1000", 6), ethers.parseEther("990.999999853399365296"), 0n);
    });

    it("should succeed, when partial buyback, with bonus", async () => {
      // 3986.938775510204081632 fxUSD = 4023.147100 stable
      // use 1000 stable, need 990.999999853399365296 fxUSD
      await buyback(ethers.parseUnits("1000", 6), ethers.parseEther("990.999999853399365296"), ethers.parseEther("1"));
    });

    it("should succeed, when full buyback, no bonus", async () => {
      // 3986.938775510204081632 fxUSD = 4023.147100 stable
      await buyback(ethers.parseUnits("4023.147100", 6), ethers.parseEther("3986.938775510204081632"), 0n);
    });

    it("should succeed, when full buyback, with bonus", async () => {
      await buyback(
        ethers.parseUnits("4023.147100", 6),
        ethers.parseEther("3986.938775510204081632"),
        ethers.parseEther("1")
      );
    });
  });
});
