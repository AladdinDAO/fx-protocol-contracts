/* eslint-disable camelcase */
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { id, ZeroAddress, ZeroHash } from "ethers";
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

const TokenRate = ethers.parseEther("1.23");

describe("PegKeeper.spec", async () => {
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
      expect(await pegKeeper.fxUSD()).to.eq(await fxUSD.getAddress());
      expect(await pegKeeper.stable()).to.eq(await stableToken.getAddress());
      expect(await pegKeeper.fxBASE()).to.eq(await fxBASE.getAddress());
      expect(await pegKeeper.converter()).to.eq(await mockConverter.getAddress());
      expect(await pegKeeper.curvePool()).to.eq(await mockCurveStableSwapNG.getAddress());
      expect(await pegKeeper.priceThreshold()).to.eq(ethers.parseEther("0.995"));
      expect(await pegKeeper.isBorrowAllowed()).to.eq(true);
      expect(await pegKeeper.isFundingEnabled()).to.eq(false);
      expect(await pegKeeper.getFxUSDPrice()).to.eq(await mockCurveStableSwapNG.price_oracle(0));
    });

    it("should revert, when initialize again", async () => {
      await expect(pegKeeper.initialize(ZeroAddress, ZeroAddress, ZeroAddress)).to.revertedWithCustomError(
        pool,
        "InvalidInitialization"
      );
    });
  });

  context("auth", async () => {
    context("updateConverter", async () => {
      it("should revert, when caller is not admin", async () => {
        await expect(pegKeeper.connect(deployer).updateConverter(ZeroAddress))
          .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should revert, when ErrorZeroAddress", async () => {
        await expect(pegKeeper.connect(admin).updateConverter(ZeroAddress)).to.revertedWithCustomError(
          pool,
          "ErrorZeroAddress"
        );
      });

      it("should succeed", async () => {
        expect(await pegKeeper.converter()).to.eq(await mockConverter.getAddress());
        await expect(pegKeeper.connect(admin).updateConverter(deployer.address))
          .to.emit(pegKeeper, "UpdateConverter")
          .withArgs(await mockConverter.getAddress(), deployer.address);
        expect(await pegKeeper.converter()).to.eq(deployer.address);
      });
    });

    context("updateCurvePool", async () => {
      it("should revert, when caller is not admin", async () => {
        await expect(pegKeeper.connect(deployer).updateCurvePool(ZeroAddress))
          .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should revert, when ErrorZeroAddress", async () => {
        await expect(pegKeeper.connect(admin).updateCurvePool(ZeroAddress)).to.revertedWithCustomError(
          pool,
          "ErrorZeroAddress"
        );
      });

      it("should succeed", async () => {
        expect(await pegKeeper.curvePool()).to.eq(await mockCurveStableSwapNG.getAddress());
        await expect(pegKeeper.connect(admin).updateCurvePool(deployer.address))
          .to.emit(pegKeeper, "UpdateCurvePool")
          .withArgs(await mockCurveStableSwapNG.getAddress(), deployer.address);
        expect(await pegKeeper.curvePool()).to.eq(deployer.address);
      });
    });

    context("updatePriceThreshold", async () => {
      it("should revert, when caller is not admin", async () => {
        await expect(pegKeeper.connect(deployer).updatePriceThreshold(0n))
          .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed", async () => {
        expect(await pegKeeper.priceThreshold()).to.eq(ethers.parseEther("0.995"));
        await expect(pegKeeper.connect(admin).updatePriceThreshold(ethers.parseEther("0.998")))
          .to.emit(pegKeeper, "UpdatePriceThreshold")
          .withArgs(ethers.parseEther("0.995"), ethers.parseEther("0.998"));
        expect(await pegKeeper.priceThreshold()).to.eq(ethers.parseEther("0.998"));
      });
    });
  });

  it("should succeed, when call isBorrowAllowed", async () => {
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("1"));
    expect(await pegKeeper.isBorrowAllowed()).to.eq(true);
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.995") + 1n);
    expect(await pegKeeper.isBorrowAllowed()).to.eq(true);
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.995"));
    expect(await pegKeeper.isBorrowAllowed()).to.eq(true);
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.995") - 1n);
    expect(await pegKeeper.isBorrowAllowed()).to.eq(false);
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.9"));
    expect(await pegKeeper.isBorrowAllowed()).to.eq(false);
  });

  it("should succeed, when call isFundingEnabled", async () => {
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("1"));
    expect(await pegKeeper.isFundingEnabled()).to.eq(false);
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.995") + 1n);
    expect(await pegKeeper.isFundingEnabled()).to.eq(false);
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.995"));
    expect(await pegKeeper.isFundingEnabled()).to.eq(false);
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.995") - 1n);
    expect(await pegKeeper.isFundingEnabled()).to.eq(true);
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.9"));
    expect(await pegKeeper.isFundingEnabled()).to.eq(true);
  });

  it("should succeed, when call getFxUSDPrice, when coin 1 is fxUSD", async () => {
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("1"));
    expect(await pegKeeper.getFxUSDPrice()).to.eq(ethers.parseEther("1"));
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.995") + 1n);
    expect(await pegKeeper.getFxUSDPrice()).to.eq(ethers.parseEther("0.995") + 1n);
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.995"));
    expect(await pegKeeper.getFxUSDPrice()).to.eq(ethers.parseEther("0.995"));
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.995") - 1n);
    expect(await pegKeeper.getFxUSDPrice()).to.eq(ethers.parseEther("0.995") - 1n);
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.9"));
    expect(await pegKeeper.getFxUSDPrice()).to.eq(ethers.parseEther("0.9"));
  });

  it("should succeed, when call getFxUSDPrice, when coin 0 is fxUSD", async () => {
    await mockCurveStableSwapNG.setCoin(0, fxUSD.getAddress());
    await mockCurveStableSwapNG.setCoin(1, stableToken.getAddress());
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("1"));
    expect(await pegKeeper.getFxUSDPrice()).to.eq(10n ** 36n / ethers.parseEther("1"));
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.995") + 1n);
    expect(await pegKeeper.getFxUSDPrice()).to.eq(10n ** 36n / (ethers.parseEther("0.995") + 1n));
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.995"));
    expect(await pegKeeper.getFxUSDPrice()).to.eq(10n ** 36n / ethers.parseEther("0.995"));
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.995") - 1n);
    expect(await pegKeeper.getFxUSDPrice()).to.eq(10n ** 36n / (ethers.parseEther("0.995") - 1n));
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.9"));
    expect(await pegKeeper.getFxUSDPrice()).to.eq(10n ** 36n / ethers.parseEther("0.9"));
  });

  context("stabilize", async () => {
    it("should revert, when caller has no STABILIZE_ROLE", async () => {
      await expect(pegKeeper.connect(deployer).stabilize(ZeroAddress, 0n, "0x"))
        .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
        .withArgs(deployer.address, id("STABILIZE_ROLE"));
    });
  });

  context("buyback", async () => {
    it("should revert, when caller has no BUYBACK_ROLE", async () => {
      await expect(pegKeeper.connect(deployer).buyback(0n, "0x"))
        .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
        .withArgs(deployer.address, id("BUYBACK_ROLE"));
    });
  });

  context("onSwap", async () => {
    it("should revert, when not in context", async () => {
      await expect(pegKeeper.onSwap(ZeroAddress, ZeroAddress, 0n, "0x")).to.revertedWithCustomError(
        pegKeeper,
        "ErrorNotInCallbackContext"
      );
    });
  });
});
