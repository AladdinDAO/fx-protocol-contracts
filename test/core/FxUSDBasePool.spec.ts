/* eslint-disable camelcase */
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { AbiCoder, id, MaxUint256, ZeroAddress, ZeroHash } from "ethers";
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

describe("FxUSDBasePool.spec", async () => {
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
        0,
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
      expect(await fxBASE.name()).to.eq("Staked f(x) USD");
      expect(await fxBASE.symbol()).to.eq("fxBASE");

      expect(await fxBASE.poolManager()).to.eq(await poolManager.getAddress());
      expect(await fxBASE.pegKeeper()).to.eq(await pegKeeper.getAddress());
      expect(await fxBASE.yieldToken()).to.eq(await fxUSD.getAddress());
      expect(await fxBASE.stableToken()).to.eq(await stableToken.getAddress());

      expect(await fxBASE.totalYieldToken()).to.eq(0n);
      expect(await fxBASE.totalStableToken()).to.eq(0n);
      expect(await fxBASE.stableDepegPrice()).to.eq(ethers.parseEther("0.95"));
    });

    it("should revert, when initialize again", async () => {
      await expect(fxBASE.initialize(ZeroAddress, "", "", 0n, 0n)).to.revertedWithCustomError(
        pool,
        "InvalidInitialization"
      );
    });
  });

  context("auth", async () => {
    context("updateStableDepegPrice", async () => {
      it("should revert, when caller not admin", async () => {
        await expect(fxBASE.connect(deployer).updateStableDepegPrice(0n))
          .to.revertedWithCustomError(fxBASE, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed", async () => {
        expect(await fxBASE.stableDepegPrice()).to.eq(ethers.parseEther("0.95"));
        await expect(fxBASE.connect(admin).updateStableDepegPrice(ethers.parseEther("0.1")))
          .to.emit(fxBASE, "UpdateStableDepegPrice")
          .withArgs(ethers.parseEther("0.95"), ethers.parseEther("0.1"));
        expect(await fxBASE.stableDepegPrice()).to.eq(ethers.parseEther("0.1"));
      });
    });
  });

  context("deposit", async () => {
    beforeEach(async () => {
      await stableToken.mint(deployer.address, ethers.parseUnits("10000", 6));
      await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
      await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

      await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);

      // open a position
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
      await poolManager
        .connect(deployer)
        .operate(pool.getAddress(), 0, ethers.parseEther("100"), ethers.parseEther("220000"));
    });

    it("should revert, when ErrInvalidTokenIn", async () => {
      await expect(fxBASE.deposit(ZeroAddress, ZeroAddress, 0n, 0n)).to.revertedWithCustomError(
        fxBASE,
        "ErrInvalidTokenIn"
      );
      await expect(fxBASE.previewDeposit(ZeroAddress, 0n)).to.revertedWithCustomError(fxBASE, "ErrInvalidTokenIn");
    });

    it("should revert, when ErrDepositZeroAmount", async () => {
      await expect(fxBASE.deposit(ZeroAddress, fxUSD.getAddress(), 0n, 0n)).to.revertedWithCustomError(
        fxBASE,
        "ErrDepositZeroAmount"
      );
    });

    it("should revert, when ErrorStableTokenDepeg", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), ethers.parseEther("1"));
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.95", 8) - 1n);
      expect(await fxBASE.getStableTokenPrice()).to.eq((ethers.parseUnits("0.95", 8) - 1n) * 10n ** 10n);
      expect(await fxBASE.getStableTokenPriceWithScale()).to.eq((ethers.parseUnits("0.95", 8) - 1n) * 10n ** 22n);
      await expect(
        fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("1"), 0n)
      ).to.revertedWithCustomError(fxBASE, "ErrorStableTokenDepeg");
    });

    it("should revert, when ErrInsufficientSharesOut", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), ethers.parseEther("1"));
      await expect(
        fxBASE
          .connect(deployer)
          .deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("1"), ethers.parseEther("1") + 1n)
      ).to.revertedWithCustomError(fxBASE, "ErrInsufficientSharesOut");
    });

    context("first time", async () => {
      it("should succeed, when deposit with fxUSD", async () => {
        const amountIn = ethers.parseEther("1");
        await fxUSD.connect(deployer).approve(fxBASE.getAddress(), amountIn);
        const shares = await fxBASE.previewDeposit(fxUSD.getAddress(), amountIn);
        expect(shares).to.eq(ethers.parseEther("1"));

        await expect(fxBASE.connect(deployer).deposit(admin.address, fxUSD.getAddress(), amountIn, shares))
          .to.emit(fxBASE, "Deposit")
          .withArgs(deployer.address, admin.address, await fxUSD.getAddress(), amountIn, shares);
        expect(await fxBASE.totalSupply()).to.eq(shares);
        expect(await fxBASE.balanceOf(admin.address)).to.eq(shares);
        expect(await fxBASE.totalYieldToken()).to.eq(amountIn);
        expect(await fxBASE.nav()).to.eq(ethers.parseEther("1"));
        expect(await fxBASE.totalStableToken()).to.eq(0n);
      });

      it("should succeed, when deposit with USDC", async () => {
        const amountIn = ethers.parseUnits("1", 6);
        await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.999", 8));
        await stableToken.connect(deployer).approve(fxBASE.getAddress(), amountIn);
        const shares = await fxBASE.previewDeposit(stableToken.getAddress(), amountIn);
        expect(shares).to.eq(ethers.parseEther("0.999"));

        await expect(fxBASE.connect(deployer).deposit(admin.address, stableToken.getAddress(), amountIn, shares))
          .to.emit(fxBASE, "Deposit")
          .withArgs(deployer.address, admin.address, await stableToken.getAddress(), amountIn, shares);
        expect(await fxBASE.totalSupply()).to.eq(shares);
        expect(await fxBASE.balanceOf(admin.address)).to.eq(shares);
        expect(await fxBASE.totalYieldToken()).to.eq(0n);
        expect(await fxBASE.totalStableToken()).to.eq(amountIn);
        expect(await fxBASE.nav()).to.eq(ethers.parseEther("1"));
      });
    });

    context("second time", async () => {
      beforeEach(async () => {
        await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.999", 8));
        await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
        await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

        await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("100"), 0n);
        await fxBASE
          .connect(deployer)
          .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("100", 6), 0n);
        expect(await fxBASE.totalStableToken()).to.eq(ethers.parseUnits("100", 6));
        expect(await fxBASE.totalYieldToken()).to.eq(ethers.parseEther("100"));
        expect(await fxBASE.totalSupply()).to.eq(ethers.parseEther("199.9"));
        expect(await fxBASE.nav()).to.eq(ethers.parseEther("1"));
      });

      it("should succeed, when deposit with fxUSD", async () => {
        const totalSharesBefore = await fxBASE.totalSupply();
        const userSharesBefore = await fxBASE.balanceOf(admin.address);
        const amountIn = ethers.parseEther("1");
        await fxUSD.connect(deployer).approve(fxBASE.getAddress(), amountIn);
        const shares = await fxBASE.previewDeposit(fxUSD.getAddress(), amountIn);
        expect(shares).to.eq(ethers.parseEther("1"));

        await expect(fxBASE.connect(deployer).deposit(admin.address, fxUSD.getAddress(), amountIn, shares))
          .to.emit(fxBASE, "Deposit")
          .withArgs(deployer.address, admin.address, await fxUSD.getAddress(), amountIn, shares);
        expect(await fxBASE.totalSupply()).to.eq(totalSharesBefore + shares);
        expect(await fxBASE.balanceOf(admin.address)).to.eq(userSharesBefore + shares);
        expect(await fxBASE.totalYieldToken()).to.eq(amountIn + ethers.parseEther("100"));
        expect(await fxBASE.nav()).to.eq(ethers.parseEther("1"));
        expect(await fxBASE.totalStableToken()).to.eq(ethers.parseUnits("100", 6));
      });

      it("should succeed, when deposit with USDC", async () => {
        const totalSharesBefore = await fxBASE.totalSupply();
        const userSharesBefore = await fxBASE.balanceOf(admin.address);
        const amountIn = ethers.parseUnits("1", 6);
        await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.999", 8));
        await stableToken.connect(deployer).approve(fxBASE.getAddress(), amountIn);
        const shares = await fxBASE.previewDeposit(stableToken.getAddress(), amountIn);
        expect(shares).to.eq(ethers.parseEther("0.999"));

        await expect(fxBASE.connect(deployer).deposit(admin.address, stableToken.getAddress(), amountIn, shares))
          .to.emit(fxBASE, "Deposit")
          .withArgs(deployer.address, admin.address, await stableToken.getAddress(), amountIn, shares);
        expect(await fxBASE.totalSupply()).to.eq(totalSharesBefore + shares);
        expect(await fxBASE.balanceOf(admin.address)).to.eq(userSharesBefore + shares);
        expect(await fxBASE.totalYieldToken()).to.eq(ethers.parseEther("100"));
        expect(await fxBASE.totalStableToken()).to.eq(amountIn + ethers.parseUnits("100", 6));
        expect(await fxBASE.nav()).to.eq(ethers.parseEther("1"));
      });
    });
  });

  context("redeem", async () => {
    beforeEach(async () => {
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("1.001", 8));
      await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
      await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

      await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);

      // open a position
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
      await poolManager
        .connect(deployer)
        .operate(pool.getAddress(), 0, ethers.parseEther("100"), ethers.parseEther("220000"));

      await stableToken.mint(deployer.address, ethers.parseUnits("220000", 6));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // deposit
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("100"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("100", 6), 0n);

      // check result
      expect(await fxBASE.totalStableToken()).to.eq(ethers.parseUnits("100", 6));
      expect(await fxBASE.totalYieldToken()).to.closeTo(ethers.parseEther("100"), 1000000n);
      expect(await fxBASE.totalSupply()).to.eq(ethers.parseEther("200.1"));
      expect(await fxBASE.balanceOf(deployer.address)).to.eq(ethers.parseEther("200.1"));
      expect(await fxBASE.nav()).to.closeTo(ethers.parseEther("1"), 1000000n);
    });

    it("should compute nav correct", async () => {
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("1.001", 8));
      await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("1.001"));
      expect(await fxBASE.nav()).to.eq(ethers.parseEther("1.000499750124937531"));
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("1.002", 8));
      await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("1.003"));
      expect(await fxBASE.nav()).to.eq(ethers.parseEther("1.001999000499750124"));
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("100"), 0n);
      // new shares is 99.950049950049950049, total shares is 300.050049950049950049
      expect(await fxBASE.nav()).to.eq(ethers.parseEther("1.002499416514261190"));
    });

    it("should revert, when ErrorRedeemLockedShares", async () => {
      await fxBASE.updateRedeemCoolDownPeriod(30);
      await fxBASE.connect(deployer).requestRedeem(0n);
      await expect(fxBASE.connect(deployer).redeem(deployer.address, 0n)).to.revertedWithCustomError(
        fxBASE,
        "ErrorRedeemLockedShares"
      );
    });

    it("should revert, when ErrRedeemZeroShares", async () => {
      await fxBASE.connect(deployer).requestRedeem(0n);
      await expect(fxBASE.connect(deployer).redeem(deployer.address, 0n)).to.revertedWithCustomError(
        fxBASE,
        "ErrRedeemZeroShares"
      );
    });

    it("should succeed when redeem to self", async () => {
      const sharesIn = ethers.parseEther("1");
      await fxBASE.connect(deployer).requestRedeem(sharesIn);
      const [fxUSDOut, stableOut] = await fxBASE.previewRedeem(sharesIn);
      expect(fxUSDOut).to.closeTo(ethers.parseEther(".4997501249375312"), 1000000n);
      expect(stableOut).to.closeTo(ethers.parseUnits(".499750", 6), 1n);
      expect(await fxBASE.connect(deployer).redeem.staticCall(deployer.address, sharesIn)).to.deep.eq([
        fxUSDOut,
        stableOut,
      ]);

      const fxusdBefore = await fxUSD.balanceOf(deployer.address);
      const stableBefore = await stableToken.balanceOf(deployer.address);
      await expect(fxBASE.connect(deployer).redeem(deployer.address, sharesIn))
        .to.emit(fxBASE, "Redeem")
        .withArgs(deployer.address, deployer.address, sharesIn, fxUSDOut, stableOut);
      const fxusdAfter = await fxUSD.balanceOf(deployer.address);
      const stableAfter = await stableToken.balanceOf(deployer.address);
      expect(stableAfter - stableBefore).to.eq(stableOut);
      expect(fxusdAfter - fxusdBefore).to.eq(fxUSDOut);
      expect(await fxBASE.totalSupply()).to.eq(ethers.parseEther("200.1") - sharesIn);
      expect(await fxBASE.balanceOf(deployer.address)).to.eq(ethers.parseEther("200.1") - sharesIn);
      expect(await fxBASE.totalStableToken()).to.eq(ethers.parseUnits("100", 6) - stableOut);
      expect(await fxBASE.totalYieldToken()).to.closeTo(ethers.parseEther("100") - fxUSDOut, 1000000n);
      expect(await fxBASE.nav()).to.closeTo(ethers.parseEther("1"), ethers.parseEther("1") / 1000000n);
    });

    it("should succeed when redeem to other", async () => {
      const sharesIn = ethers.parseEther("1");
      await fxBASE.connect(deployer).requestRedeem(sharesIn);
      const [fxUSDOut, stableOut] = await fxBASE.previewRedeem(sharesIn);
      expect(fxUSDOut).to.closeTo(ethers.parseEther(".4997501249375312"), 1000000n);
      expect(stableOut).to.closeTo(ethers.parseUnits(".499750", 6), 1n);
      expect(await fxBASE.connect(deployer).redeem.staticCall(deployer.address, sharesIn)).to.deep.eq([
        fxUSDOut,
        stableOut,
      ]);

      const fxusdBefore = await fxUSD.balanceOf(admin.address);
      const stableBefore = await stableToken.balanceOf(admin.address);
      await expect(fxBASE.connect(deployer).redeem(admin.address, sharesIn))
        .to.emit(fxBASE, "Redeem")
        .withArgs(deployer.address, admin.address, sharesIn, fxUSDOut, stableOut);
      const fxusdAfter = await fxUSD.balanceOf(admin.address);
      const stableAfter = await stableToken.balanceOf(admin.address);
      expect(stableAfter - stableBefore).to.eq(stableOut);
      expect(fxusdAfter - fxusdBefore).to.eq(fxUSDOut);
      expect(await fxBASE.totalSupply()).to.eq(ethers.parseEther("200.1") - sharesIn);
      expect(await fxBASE.balanceOf(deployer.address)).to.eq(ethers.parseEther("200.1") - sharesIn);
      expect(await fxBASE.totalStableToken()).to.eq(ethers.parseUnits("100", 6) - stableOut);
      expect(await fxBASE.totalYieldToken()).to.closeTo(ethers.parseEther("100") - fxUSDOut, 1000000n);
      expect(await fxBASE.nav()).to.closeTo(ethers.parseEther("1"), ethers.parseEther("1") / 1000000n);
    });
  });

  context("rebalance on tick", async () => {
    beforeEach(async () => {
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.991", 8));
      await stableToken.mint(deployer.address, ethers.parseUnits("220000", 6));
      await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
      await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

      await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);

      // remove open fee
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
      // remove liquidation expense fee
      await poolManager.connect(admin).updateExpenseRatio(0n, 0n, 0n);

      // open 3 positions on the same tick
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
    });

    it("should succeed, when only use fxUSD, provide fxUSD", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("4000"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("4000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // revert ErrorInsufficientOutput
      await expect(
        fxBASE
          .connect(deployer)
          ["rebalance(address,int16,address,uint256,uint256)"](
            pool.getAddress(),
            4997,
            fxUSD.getAddress(),
            ethers.parseEther("3990"),
            ethers.parseEther("1.661224489795918366") + 1n
          )
      ).to.revertedWithCustomError(fxBASE, "ErrorInsufficientOutput");

      // rebalance to 0.88
      // need 3986.938775510204081632 fxUSD and get 1.661224489795918366 collateral
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdBefore = await fxUSD.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        ["rebalance(address,int16,address,uint256,uint256)"](
          pool.getAddress(),
          4997,
          fxUSD.getAddress(),
          ethers.parseEther("3990"),
          0n
        );
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdAfter = await fxUSD.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(0n);
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(0n);
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(0n);
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(0n);
      expect(fxusdBefore - fxusdAfter).to.eq(ethers.parseEther("3986.938775510204081632"));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("1.661224489795918366"));
    });

    it("should succeed, when only use fxUSD, provide stable", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("4000"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("4000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // rebalance to 0.88
      // need 3986.938775510204081632 fxUSD and get 1.661224489795918366 collateral
      // 3986.938775510204081632 fxUSD = 4023.147100 USDC
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const stableBefore = await stableToken.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        ["rebalance(address,int16,address,uint256,uint256)"](
          pool.getAddress(),
          4997,
          stableToken.getAddress(),
          ethers.parseUnits("4026.236125"),
          0n
        );
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const stableAfter = await stableToken.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(-ethers.parseEther("3986.938775510204081632"));
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(ethers.parseUnits("4023.147100", 6));
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(-ethers.parseEther("3986.938775510204081632"));
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(ethers.parseUnits("4023.147100", 6));
      expect(stableBefore - stableAfter).to.eq(ethers.parseUnits("4023.147100", 6));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("1.661224489795918366"));
    });

    it("should succeed, when only use stable, provide fxUSD", async () => {
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("5000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      // stable = ceil(3986.938775510204081632 / 0.991) = 4023.147100
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // rebalance to 0.88
      // need 4023.147100 USDC and get 1.661224489795918366 collateral
      // fxUSD is 4023.147100 * 0.991 = 3986.938776100
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdBefore = await fxUSD.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        ["rebalance(address,int16,address,uint256,uint256)"](
          pool.getAddress(),
          4997,
          fxUSD.getAddress(),
          ethers.parseEther("3990"),
          0n
        );
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdAfter = await fxUSD.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(ethers.parseEther("3986.938776100"));
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(-ethers.parseUnits("4023.147100", 6));
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(ethers.parseEther("3986.938776100"));
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(-ethers.parseUnits("4023.147100", 6));
      expect(fxusdBefore - fxusdAfter).to.eq(ethers.parseEther("3986.938776100"));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("1.661224489795918366"));
    });

    it("should succeed, when only use stable, provide stable", async () => {
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("5000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      // stable = ceil(3986.938775510204081632 / 0.991) = 4023.147100
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // rebalance to 0.88
      // need 4023.147100 USDC and get 1.661224489795918366 collateral
      // fxUSD is 4023.147100 * 0.991 = 3986.938776100
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const stableBefore = await stableToken.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        ["rebalance(address,int16,address,uint256,uint256)"](
          pool.getAddress(),
          4997,
          stableToken.getAddress(),
          ethers.parseEther("5000"),
          0n
        );
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const stableAfter = await stableToken.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(0n);
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(0n);
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(0n);
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(0n);
      expect(stableBefore - stableAfter).to.eq(ethers.parseUnits("4023.147100", 6));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("1.661224489795918366"));
    });

    it("should succeed, when only use fxUSD + stable, provide fxUSD", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("2000"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("3000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // rebalance to 0.88
      // need 3986.938775510204081632 fxUSD and get 1.661224489795918366 collateral
      // fxUSD = 2000, stable = ceil(1986.938775510204081632 / 0.991) = 2004.983629
      // fxUSD provided = 2000 + 2004.983629 * 0.991 = 3986.938776339
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdBefore = await fxUSD.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        ["rebalance(address,int16,address,uint256,uint256)"](
          pool.getAddress(),
          4997,
          fxUSD.getAddress(),
          ethers.parseEther("3990"),
          0n
        );
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdAfter = await fxUSD.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(ethers.parseEther("1986.938776339"));
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(-ethers.parseUnits("2004.983629", 6));
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(ethers.parseEther("1986.938776339"));
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(-ethers.parseUnits("2004.983629", 6));
      expect(fxusdBefore - fxusdAfter).to.eq(ethers.parseEther("3986.938776339"));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("1.661224489795918366"));
    });

    it("should succeed, when only use fxUSD + stable, provide stable", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("2000"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("3000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // rebalance to 0.88
      // need 3986.938775510204081632 fxUSD and get 1.661224489795918366 collateral
      // fxUSD = 2000, stable = ceil(1986.938775510204081632 / 0.991) = 2004.983629
      // stable provided = 2004.983629 + ceil(2000 / 0.991) = 4023.147101
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const stableBefore = await stableToken.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        ["rebalance(address,int16,address,uint256,uint256)"](
          pool.getAddress(),
          4997,
          stableToken.getAddress(),
          ethers.parseEther("5000"),
          0n
        );
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const stableAfter = await stableToken.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(-ethers.parseEther("2000"));
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(ethers.parseUnits("2018.163472", 6));
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(-ethers.parseEther("2000"));
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(ethers.parseUnits("2018.163472", 6));
      expect(stableBefore - stableAfter).to.eq(ethers.parseUnits("4023.147101", 6));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("1.661224489795918366"));
    });
  });

  context("batch rebalance", async () => {
    beforeEach(async () => {
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.991", 8));
      await stableToken.mint(deployer.address, ethers.parseUnits("220000", 6));
      await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
      await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

      await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);

      // remove open fee
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
      // remove liquidation expense fee
      await poolManager.connect(admin).updateExpenseRatio(0n, 0n, 0n);

      // open 3 positions on the same tick
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
    });

    it("should succeed, when only use fxUSD, provide fxUSD", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("4000"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("4000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // revert ErrorInsufficientOutput
      await expect(
        fxBASE
          .connect(deployer)
          ["rebalance(address,address,uint256,uint256)"](
            pool.getAddress(),
            fxUSD.getAddress(),
            ethers.parseEther("3990"),
            ethers.parseEther("1.661224489795918366") + 1n
          )
      ).to.revertedWithCustomError(fxBASE, "ErrorInsufficientOutput");

      // rebalance to 0.88
      // need 3986.938775510204081632 fxUSD and get 1.661224489795918366 collateral
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdBefore = await fxUSD.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        ["rebalance(address,address,uint256,uint256)"](
          pool.getAddress(),
          fxUSD.getAddress(),
          ethers.parseEther("3990"),
          0n
        );
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdAfter = await fxUSD.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(0n);
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(0n);
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(0n);
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(0n);
      expect(fxusdBefore - fxusdAfter).to.eq(ethers.parseEther("3986.938775510204081632"));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("1.661224489795918366"));
    });

    it("should succeed, when only use fxUSD, provide stable", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("4000"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("4000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // rebalance to 0.88
      // need 3986.938775510204081632 fxUSD and get 1.661224489795918366 collateral
      // 3986.938775510204081632 fxUSD = 4023.147100 USDC
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const stableBefore = await stableToken.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        ["rebalance(address,address,uint256,uint256)"](
          pool.getAddress(),
          stableToken.getAddress(),
          ethers.parseUnits("4026.236125"),
          0n
        );
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const stableAfter = await stableToken.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(-ethers.parseEther("3986.938775510204081632"));
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(ethers.parseUnits("4023.147100", 6));
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(-ethers.parseEther("3986.938775510204081632"));
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(ethers.parseUnits("4023.147100", 6));
      expect(stableBefore - stableAfter).to.eq(ethers.parseUnits("4023.147100", 6));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("1.661224489795918366"));
    });

    it("should succeed, when only use stable, provide fxUSD", async () => {
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("5000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      // stable = ceil(3986.938775510204081632 / 0.991) = 4023.147100
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // rebalance to 0.88
      // need 4023.147100 USDC and get 1.661224489795918366 collateral
      // fxUSD is 4023.147100 * 0.991 = 3986.938776100
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdBefore = await fxUSD.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        ["rebalance(address,address,uint256,uint256)"](
          pool.getAddress(),
          fxUSD.getAddress(),
          ethers.parseEther("3990"),
          0n
        );
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdAfter = await fxUSD.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(ethers.parseEther("3986.938776100"));
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(-ethers.parseUnits("4023.147100", 6));
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(ethers.parseEther("3986.938776100"));
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(-ethers.parseUnits("4023.147100", 6));
      expect(fxusdBefore - fxusdAfter).to.eq(ethers.parseEther("3986.938776100"));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("1.661224489795918366"));
    });

    it("should succeed, when only use stable, provide stable", async () => {
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("5000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      // stable = ceil(3986.938775510204081632 / 0.991) = 4023.147100
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // rebalance to 0.88
      // need 4023.147100 USDC and get 1.661224489795918366 collateral
      // fxUSD is 4023.147100 * 0.991 = 3986.938776100
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const stableBefore = await stableToken.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        ["rebalance(address,address,uint256,uint256)"](
          pool.getAddress(),
          stableToken.getAddress(),
          ethers.parseEther("5000"),
          0n
        );
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const stableAfter = await stableToken.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(0n);
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(0n);
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(0n);
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(0n);
      expect(stableBefore - stableAfter).to.eq(ethers.parseUnits("4023.147100", 6));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("1.661224489795918366"));
    });

    it("should succeed, when only use fxUSD + stable, provide fxUSD", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("2000"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("3000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // rebalance to 0.88
      // need 3986.938775510204081632 fxUSD and get 1.661224489795918366 collateral
      // fxUSD = 2000, stable = ceil(1986.938775510204081632 / 0.991) = 2004.983629
      // fxUSD provided = 2000 + 2004.983629 * 0.991 = 3986.938776339
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdBefore = await fxUSD.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        ["rebalance(address,address,uint256,uint256)"](
          pool.getAddress(),
          fxUSD.getAddress(),
          ethers.parseEther("3990"),
          0n
        );
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdAfter = await fxUSD.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(ethers.parseEther("1986.938776339"));
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(-ethers.parseUnits("2004.983629", 6));
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(ethers.parseEther("1986.938776339"));
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(-ethers.parseUnits("2004.983629", 6));
      expect(fxusdBefore - fxusdAfter).to.eq(ethers.parseEther("3986.938776339"));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("1.661224489795918366"));
    });

    it("should succeed, when only use fxUSD + stable, provide stable", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("2000"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("3000", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
      // raw debts = 3986.938775510204081632
      // fxusd = 3986.938775510204081632
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // rebalance to 0.88
      // need 3986.938775510204081632 fxUSD and get 1.661224489795918366 collateral
      // fxUSD = 2000, stable = ceil(1986.938775510204081632 / 0.991) = 2004.983629
      // stable provided = 2004.983629 + ceil(2000 / 0.991) = 4023.147101
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const stableBefore = await stableToken.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        ["rebalance(address,address,uint256,uint256)"](
          pool.getAddress(),
          stableToken.getAddress(),
          ethers.parseEther("5000"),
          0n
        );
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const stableAfter = await stableToken.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(-ethers.parseEther("2000"));
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(ethers.parseUnits("2018.163472", 6));
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(-ethers.parseEther("2000"));
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(ethers.parseUnits("2018.163472", 6));
      expect(stableBefore - stableAfter).to.eq(ethers.parseUnits("4023.147101", 6));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("1.661224489795918366"));
    });
  });

  context("batch liquidate", async () => {
    beforeEach(async () => {
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.991", 8));
      await stableToken.mint(deployer.address, ethers.parseUnits("220000", 6));
      await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
      await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

      // remove open fee
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
      await pool.connect(admin).updateDebtRatioRange(0, ethers.parseEther("1"));
      // remove liquidation expense fee
      await poolManager.connect(admin).updateExpenseRatio(0n, 0n, 0n);

      await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);

      // open 3 positions on the same tick
      await poolManager
        .connect(deployer)
        .operate(pool.getAddress(), 0, ethers.parseEther("0.1"), ethers.parseEther("220"));
      await poolManager
        .connect(deployer)
        .operate(pool.getAddress(), 0, ethers.parseEther("1"), ethers.parseEther("1000"));
      await poolManager
        .connect(deployer)
        .operate(pool.getAddress(), 0, ethers.parseEther("10"), ethers.parseEther("10000"));
      expect(await pool.getNextTreeNodeId()).to.eq(3);
      expect(await pool.getTopTick()).to.eq(4997);
    });

    it("should succeed, when only use fxUSD, provide fxUSD", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("220"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("220", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 1900, debt ratio became 0.941377834830979888
      // debts = 220
      // raw colls = 220/1900*1.05 = 0.121578947368421052, colls = 0.121578947368421052/1.23 = 0.098844672657252887
      await mockPriceOracle.setPrices(ethers.parseEther("1900"), ethers.parseEther("1900"), ethers.parseEther("1900"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // revert ErrorInsufficientOutput
      await expect(
        fxBASE
          .connect(deployer)
          .liquidate(
            pool.getAddress(),
            fxUSD.getAddress(),
            ethers.parseEther("3990"),
            ethers.parseEther("0.098844672657252887") + 1n
          )
      ).to.revertedWithCustomError(fxBASE, "ErrorInsufficientOutput");

      // liquidate position 1
      // need 220 fxUSD and get 0.098844672657252887 collateral
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdBefore = await fxUSD.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE.connect(deployer).liquidate(pool.getAddress(), fxUSD.getAddress(), ethers.parseEther("3990"), 0n);
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdAfter = await fxUSD.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(0n);
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(0n);
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(0n);
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(0n);
      expect(fxusdBefore - fxusdAfter).to.eq(ethers.parseEther("220"));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("0.098844672657252887"));
    });

    it("should succeed, when only use fxUSD, provide stable", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("220"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("220", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 1900, debt ratio became 0.941377834830979888
      // debts = 220
      // raw colls = 220/1900*1.05 = 0.121578947368421052, colls = 0.121578947368421052/1.23 = 0.098844672657252887
      await mockPriceOracle.setPrices(ethers.parseEther("1900"), ethers.parseEther("1900"), ethers.parseEther("1900"));
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // liquidate position 1
      // need 220 fxUSD and get 0.098844672657252887 collateral
      // 220 fxUSD = 221.997982 USDC
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const stableBefore = await stableToken.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        .liquidate(pool.getAddress(), stableToken.getAddress(), ethers.parseUnits("4026.236125"), 0n);
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const stableAfter = await stableToken.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(-ethers.parseEther("220"));
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(ethers.parseUnits("221.997982", 6));
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(-ethers.parseEther("220"));
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(ethers.parseUnits("221.997982", 6));
      expect(stableBefore - stableAfter).to.eq(ethers.parseUnits("221.997982", 6));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("0.098844672657252887"));
    });

    it("should succeed, when only use stable, provide fxUSD", async () => {
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("300", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 1900, debt ratio became 0.941377834830979888
      // debts = 220
      // raw colls = 220/1900*1.05 = 0.121578947368421052, colls = 0.121578947368421052/1.23 = 0.098844672657252887
      await mockPriceOracle.setPrices(ethers.parseEther("1900"), ethers.parseEther("1900"), ethers.parseEther("1900"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // liquidate position 1
      // need 221.997982 stable and get 0.098844672657252887 collateral
      // fxUSD is 221.997982 * 0.991 = 220.000000162
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdBefore = await fxUSD.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE.connect(deployer).liquidate(pool.getAddress(), fxUSD.getAddress(), ethers.parseEther("3990"), 0n);
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdAfter = await fxUSD.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(ethers.parseEther("220.000000162"));
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(-ethers.parseUnits("221.997982", 6));
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(ethers.parseEther("220.000000162"));
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(-ethers.parseUnits("221.997982", 6));
      expect(fxusdBefore - fxusdAfter).to.eq(ethers.parseEther("220.000000162"));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("0.098844672657252887"));
    });

    it("should succeed, when only use stable, provide stable", async () => {
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("300", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 1900, debt ratio became 0.941377834830979888
      // debts = 220
      // raw colls = 220/1900*1.05 = 0.121578947368421052, colls = 0.121578947368421052/1.23 = 0.098844672657252887
      await mockPriceOracle.setPrices(ethers.parseEther("1900"), ethers.parseEther("1900"), ethers.parseEther("1900"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // liquidate position 1
      // need 221.997982 stable and get 0.098844672657252887 collateral
      // fxUSD is 221.997982 * 0.991 = 220.000000162
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const stableBefore = await stableToken.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        .liquidate(pool.getAddress(), stableToken.getAddress(), ethers.parseEther("5000"), 0n);
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const stableAfter = await stableToken.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(0n);
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(0n);
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(0n);
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(0n);
      expect(stableBefore - stableAfter).to.eq(ethers.parseUnits("221.997982", 6));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("0.098844672657252887"));
    });

    it("should succeed, when only use fxUSD + stable, provide fxUSD", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("200"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("400", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 1900, debt ratio became 0.941377834830979888
      // debts = 220
      // raw colls = 220/1900*1.05 = 0.121578947368421052, colls = 0.121578947368421052/1.23 = 0.098844672657252887
      await mockPriceOracle.setPrices(ethers.parseEther("1900"), ethers.parseEther("1900"), ethers.parseEther("1900"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // liquidate position 1
      // need 220 fxUSD and get 0.098844672657252887 collateral
      // fxUSD = 200, stable = ceil(20 / 0.991) = 20.181635
      // fxUSD provided = 200 + 20.181635 * 0.991 = 220.000000285
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdBefore = await fxUSD.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE.connect(deployer).liquidate(pool.getAddress(), fxUSD.getAddress(), ethers.parseEther("3990"), 0n);
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const fxusdAfter = await fxUSD.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(ethers.parseEther("20.000000285"));
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(-ethers.parseUnits("20.181635", 6));
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(ethers.parseEther("20.000000285"));
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(-ethers.parseUnits("20.181635", 6));
      expect(fxusdBefore - fxusdAfter).to.eq(ethers.parseEther("220.000000285"));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("0.098844672657252887"));
    });

    it("should succeed, when only use fxUSD + stable, provide stable", async () => {
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("200"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("500", 6), 0n);

      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 1900, debt ratio became 0.941377834830979888
      // debts = 220
      // raw colls = 220/1900*1.05 = 0.121578947368421052, colls = 0.121578947368421052/1.23 = 0.098844672657252887
      await mockPriceOracle.setPrices(ethers.parseEther("1900"), ethers.parseEther("1900"), ethers.parseEther("1900"));
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);

      // liquidate position 1
      // need 220 fxUSD and get 0.098844672657252887 collateral
      // fxUSD = 200, stable = ceil(20 / 0.991) = 20.181635
      // stable provided = ceil(200 / 0.991) + 20.181635 = 221.997983
      const totalYieldTokenBefore = await fxBASE.totalYieldToken();
      const totalStableTokenBefore = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseBefore = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseBefore = await stableToken.balanceOf(fxBASE.getAddress());
      const stableBefore = await stableToken.balanceOf(deployer.address);
      const collateralBefore = await collateralToken.balanceOf(deployer.address);
      await fxBASE
        .connect(deployer)
        .liquidate(pool.getAddress(), stableToken.getAddress(), ethers.parseEther("5000"), 0n);
      const totalYieldTokenAfter = await fxBASE.totalYieldToken();
      const totalStableTokenAfter = await fxBASE.totalStableToken();
      const fxusdBalanceInBaseAfter = await fxUSD.balanceOf(fxBASE.getAddress());
      const stableBalanceInBaseAfter = await stableToken.balanceOf(fxBASE.getAddress());
      const stableAfter = await stableToken.balanceOf(deployer.address);
      const collateralAfter = await collateralToken.balanceOf(deployer.address);
      expect(totalYieldTokenAfter).to.eq(fxusdBalanceInBaseAfter);
      expect(totalStableTokenAfter).to.eq(stableBalanceInBaseAfter);
      expect(totalYieldTokenAfter - totalYieldTokenBefore).to.eq(-ethers.parseEther("200"));
      expect(totalStableTokenAfter - totalStableTokenBefore).to.eq(ethers.parseUnits("201.816348", 6));
      expect(fxusdBalanceInBaseAfter - fxusdBalanceInBaseBefore).to.eq(-ethers.parseEther("200"));
      expect(stableBalanceInBaseAfter - stableBalanceInBaseBefore).to.eq(ethers.parseUnits("201.816348", 6));
      expect(stableBefore - stableAfter).to.eq(ethers.parseUnits("221.997983", 6));
      expect(collateralAfter - collateralBefore).to.eq(ethers.parseEther("0.098844672657252887"));
    });
  });

  context("arbitrage", async () => {
    beforeEach(async () => {
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.991", 8));
      await stableToken.mint(deployer.address, ethers.parseUnits("220000", 6));
      await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
      await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

      await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);

      // open a position
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
      await poolManager
        .connect(deployer)
        .operate(pool.getAddress(), 0, ethers.parseEther("100"), ethers.parseEther("220000"));

      // deposit to fxBase
      await fxUSD.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(fxBASE.getAddress(), MaxUint256);
      await fxBASE.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("1000"), 0n);
      await fxBASE
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("1000", 6), 0n);
    });

    it("should revert, when invalid token", async () => {
      await unlockAccounts([await pegKeeper.getAddress()]);
      const signer = await ethers.getSigner(await pegKeeper.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));
      await expect(fxBASE.connect(signer).arbitrage(ZeroAddress, 0n, ZeroAddress, "0x")).to.revertedWithCustomError(
        fxBASE,
        "ErrInvalidTokenIn"
      );
    });

    it("should revert, when caller not peg keeper", async () => {
      await expect(
        fxBASE.connect(deployer).arbitrage(fxUSD.getAddress(), 0n, ZeroAddress, "0x")
      ).to.revertedWithCustomError(fxBASE, "ErrorCallerNotPegKeeper");
    });

    it("should revert, when ErrorStableTokenDepeg", async () => {
      await unlockAccounts([await pegKeeper.getAddress()]);
      const signer = await ethers.getSigner(await pegKeeper.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.95", 8) - 1n);
      await expect(
        fxBASE.connect(signer).arbitrage(fxUSD.getAddress(), 0n, ZeroAddress, "0x")
      ).to.revertedWithCustomError(fxBASE, "ErrorStableTokenDepeg");
    });

    it("should revert, when ErrorSwapExceedBalance, input is fxUSD", async () => {
      await unlockAccounts([await pegKeeper.getAddress()]);
      const signer = await ethers.getSigner(await pegKeeper.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));
      await expect(
        fxBASE.connect(signer).arbitrage(fxUSD.getAddress(), ethers.parseEther("1000") + 1n, ZeroAddress, "0x")
      ).to.revertedWithCustomError(fxBASE, "ErrorSwapExceedBalance");
    });

    it("should revert, when ErrorSwapExceedBalance, input is stable", async () => {
      await unlockAccounts([await pegKeeper.getAddress()]);
      const signer = await ethers.getSigner(await pegKeeper.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));
      await expect(
        fxBASE.connect(signer).arbitrage(stableToken.getAddress(), ethers.parseUnits("1000", 6) + 1n, ZeroAddress, "0x")
      ).to.revertedWithCustomError(fxBASE, "ErrorSwapExceedBalance");
    });

    context("arbitrage with fxUSD", async () => {
      beforeEach(async () => {
        await pegKeeper.connect(admin).grantRole(id("STABILIZE_ROLE"), deployer.address);
      });

      it("should revert, when ErrorInsufficientArbitrage", async () => {
        // 1 fxUSD => 1.009081 stable, 1 stable => 0.991 fxUSD
        await mockConverter.setTokenOut(stableToken.getAddress(), ethers.parseUnits("1.009080", 6));
        await stableToken.transfer(mockConverter.getAddress(), ethers.parseUnits("1.009080", 6));
        await expect(
          pegKeeper
            .connect(deployer)
            .stabilize(
              fxUSD,
              ethers.parseEther("1"),
              AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256[]"], [0n, 0n, []])
            )
        ).to.revertedWithCustomError(fxBASE, "ErrorInsufficientArbitrage");
      });

      it("should succeed, when no bonus", async () => {
        // 1 fxUSD => 1.009082 stable, 1 stable => 0.991 fxUSD
        await mockConverter.setTokenOut(stableToken.getAddress(), ethers.parseUnits("1.009082", 6));
        await stableToken.transfer(mockConverter.getAddress(), ethers.parseUnits("1.009082", 6));
        const totalYieldBefore = await fxBASE.totalYieldToken();
        const totalStableBefore = await fxBASE.totalStableToken();
        const yieldBalanceBefore = await fxUSD.balanceOf(fxBASE.getAddress());
        const stableBalanceBefore = await stableToken.balanceOf(fxBASE.getAddress());
        const callerYieldBalanceBefore = await fxUSD.balanceOf(deployer.getAddress());
        const callerStableBalanceBefore = await stableToken.balanceOf(deployer.getAddress());
        await expect(
          pegKeeper
            .connect(deployer)
            .stabilize(
              fxUSD,
              ethers.parseEther("1"),
              AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256[]"], [0n, 0n, []])
            )
        )
          .to.emit(fxBASE, "Arbitrage")
          .withArgs(
            await pegKeeper.getAddress(),
            await fxUSD.getAddress(),
            ethers.parseEther("1"),
            ethers.parseUnits("1.009082", 6),
            0n
          );
        const totalYieldAfter = await fxBASE.totalYieldToken();
        const totalStableAfter = await fxBASE.totalStableToken();
        const yieldBalanceAfter = await fxUSD.balanceOf(fxBASE.getAddress());
        const stableBalanceAfter = await stableToken.balanceOf(fxBASE.getAddress());
        const callerYieldBalanceAfter = await fxUSD.balanceOf(deployer.getAddress());
        const callerStableBalanceAfter = await stableToken.balanceOf(deployer.getAddress());
        expect(totalYieldAfter).to.eq(yieldBalanceAfter);
        expect(totalStableAfter).to.eq(stableBalanceAfter);
        expect(totalYieldAfter - totalYieldBefore).to.eq(-ethers.parseEther("1"));
        expect(totalStableAfter - totalStableBefore).to.eq(ethers.parseUnits("1.009082", 6));
        expect(yieldBalanceAfter - yieldBalanceBefore).to.eq(-ethers.parseEther("1"));
        expect(stableBalanceAfter - stableBalanceBefore).to.eq(ethers.parseUnits("1.009082", 6));
        expect(callerYieldBalanceAfter - callerYieldBalanceBefore).to.eq(0n);
        expect(callerStableBalanceAfter - callerStableBalanceBefore).to.eq(0n);
      });

      it("should succeed, when with bonus", async () => {
        // 1 fxUSD => 1.009082 stable, 1 stable => 0.991 fxUSD
        await mockConverter.setTokenOut(
          stableToken.getAddress(),
          ethers.parseUnits("1.009082", 6) + ethers.parseUnits("1", 6)
        );
        await stableToken.transfer(
          mockConverter.getAddress(),
          ethers.parseUnits("1.009082", 6) + ethers.parseUnits("1", 6)
        );
        const totalYieldBefore = await fxBASE.totalYieldToken();
        const totalStableBefore = await fxBASE.totalStableToken();
        const yieldBalanceBefore = await fxUSD.balanceOf(fxBASE.getAddress());
        const stableBalanceBefore = await stableToken.balanceOf(fxBASE.getAddress());
        const callerYieldBalanceBefore = await fxUSD.balanceOf(deployer.getAddress());
        const callerStableBalanceBefore = await stableToken.balanceOf(deployer.getAddress());
        await expect(
          pegKeeper
            .connect(deployer)
            .stabilize(
              fxUSD,
              ethers.parseEther("1"),
              AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256[]"], [0n, 0n, []])
            )
        )
          .to.emit(fxBASE, "Arbitrage")
          .withArgs(
            await pegKeeper.getAddress(),
            await fxUSD.getAddress(),
            ethers.parseEther("1"),
            ethers.parseUnits("1.009082", 6) + ethers.parseUnits("1", 6),
            ethers.parseUnits("1", 6)
          );
        const totalYieldAfter = await fxBASE.totalYieldToken();
        const totalStableAfter = await fxBASE.totalStableToken();
        const yieldBalanceAfter = await fxUSD.balanceOf(fxBASE.getAddress());
        const stableBalanceAfter = await stableToken.balanceOf(fxBASE.getAddress());
        const callerYieldBalanceAfter = await fxUSD.balanceOf(deployer.getAddress());
        const callerStableBalanceAfter = await stableToken.balanceOf(deployer.getAddress());
        expect(totalYieldAfter).to.eq(yieldBalanceAfter);
        expect(totalStableAfter).to.eq(stableBalanceAfter);
        expect(totalYieldAfter - totalYieldBefore).to.eq(-ethers.parseEther("1"));
        expect(totalStableAfter - totalStableBefore).to.eq(ethers.parseUnits("1.009082", 6));
        expect(yieldBalanceAfter - yieldBalanceBefore).to.eq(-ethers.parseEther("1"));
        expect(stableBalanceAfter - stableBalanceBefore).to.eq(ethers.parseUnits("1.009082", 6));
        expect(callerYieldBalanceAfter - callerYieldBalanceBefore).to.eq(0n);
        expect(callerStableBalanceAfter - callerStableBalanceBefore).to.eq(ethers.parseUnits("1", 6));
      });
    });

    context("arbitrage with stable", async () => {
      beforeEach(async () => {
        await pegKeeper.connect(admin).grantRole(id("STABILIZE_ROLE"), deployer.address);
      });

      it("should revert, when ErrorInsufficientArbitrage", async () => {
        // 1 fxUSD => 1.009081 stable, 1 stable => 0.991 fxUSD
        await mockConverter.setTokenOut(fxUSD.getAddress(), ethers.parseEther("0.991") - 1n);
        await fxUSD.connect(deployer).transfer(mockConverter.getAddress(), ethers.parseEther("0.991") - 1n);
        await expect(
          pegKeeper
            .connect(deployer)
            .stabilize(
              stableToken,
              ethers.parseUnits("1", 6),
              AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256[]"], [0n, 0n, []])
            )
        ).to.revertedWithCustomError(fxBASE, "ErrorInsufficientArbitrage");
      });

      it("should succeed, when no bonus", async () => {
        // 1 fxUSD => 1.009082 stable, 1 stable => 0.991 fxUSD
        await mockConverter.setTokenOut(fxUSD.getAddress(), ethers.parseEther("0.991"));
        await fxUSD.connect(deployer).transfer(mockConverter.getAddress(), ethers.parseEther("0.991"));
        const totalYieldBefore = await fxBASE.totalYieldToken();
        const totalStableBefore = await fxBASE.totalStableToken();
        const yieldBalanceBefore = await fxUSD.balanceOf(fxBASE.getAddress());
        const stableBalanceBefore = await stableToken.balanceOf(fxBASE.getAddress());
        const callerYieldBalanceBefore = await fxUSD.balanceOf(deployer.getAddress());
        const callerStableBalanceBefore = await stableToken.balanceOf(deployer.getAddress());
        await expect(
          pegKeeper
            .connect(deployer)
            .stabilize(
              stableToken,
              ethers.parseUnits("1", 6),
              AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256[]"], [0n, 0n, []])
            )
        )
          .to.emit(fxBASE, "Arbitrage")
          .withArgs(
            await pegKeeper.getAddress(),
            await stableToken.getAddress(),
            ethers.parseUnits("1", 6),
            ethers.parseEther("0.991"),
            0n
          );
        const totalYieldAfter = await fxBASE.totalYieldToken();
        const totalStableAfter = await fxBASE.totalStableToken();
        const yieldBalanceAfter = await fxUSD.balanceOf(fxBASE.getAddress());
        const stableBalanceAfter = await stableToken.balanceOf(fxBASE.getAddress());
        const callerYieldBalanceAfter = await fxUSD.balanceOf(deployer.getAddress());
        const callerStableBalanceAfter = await stableToken.balanceOf(deployer.getAddress());
        expect(totalYieldAfter).to.eq(yieldBalanceAfter);
        expect(totalStableAfter).to.eq(stableBalanceAfter);
        expect(totalYieldAfter - totalYieldBefore).to.eq(ethers.parseEther("0.991"));
        expect(totalStableAfter - totalStableBefore).to.eq(-ethers.parseUnits("1", 6));
        expect(yieldBalanceAfter - yieldBalanceBefore).to.eq(ethers.parseEther("0.991"));
        expect(stableBalanceAfter - stableBalanceBefore).to.eq(-ethers.parseUnits("1", 6));
        expect(callerYieldBalanceAfter - callerYieldBalanceBefore).to.eq(0n);
        expect(callerStableBalanceAfter - callerStableBalanceBefore).to.eq(0n);
      });

      it("should succeed, when with bonus", async () => {
        // 1 fxUSD => 1.009082 stable, 1 stable => 0.991 fxUSD
        await mockConverter.setTokenOut(fxUSD.getAddress(), ethers.parseEther("1.991"));
        await fxUSD.connect(deployer).transfer(mockConverter.getAddress(), ethers.parseEther("1.991"));
        const totalYieldBefore = await fxBASE.totalYieldToken();
        const totalStableBefore = await fxBASE.totalStableToken();
        const yieldBalanceBefore = await fxUSD.balanceOf(fxBASE.getAddress());
        const stableBalanceBefore = await stableToken.balanceOf(fxBASE.getAddress());
        const callerYieldBalanceBefore = await fxUSD.balanceOf(deployer.getAddress());
        const callerStableBalanceBefore = await stableToken.balanceOf(deployer.getAddress());
        await expect(
          pegKeeper
            .connect(deployer)
            .stabilize(
              stableToken,
              ethers.parseUnits("1", 6),
              AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256[]"], [0n, 0n, []])
            )
        )
          .to.emit(fxBASE, "Arbitrage")
          .withArgs(
            await pegKeeper.getAddress(),
            await stableToken.getAddress(),
            ethers.parseUnits("1", 6),
            ethers.parseEther("1.991"),
            ethers.parseEther("1")
          );
        const totalYieldAfter = await fxBASE.totalYieldToken();
        const totalStableAfter = await fxBASE.totalStableToken();
        const yieldBalanceAfter = await fxUSD.balanceOf(fxBASE.getAddress());
        const stableBalanceAfter = await stableToken.balanceOf(fxBASE.getAddress());
        const callerYieldBalanceAfter = await fxUSD.balanceOf(deployer.getAddress());
        const callerStableBalanceAfter = await stableToken.balanceOf(deployer.getAddress());
        expect(totalYieldAfter).to.eq(yieldBalanceAfter);
        expect(totalStableAfter).to.eq(stableBalanceAfter);
        expect(totalYieldAfter - totalYieldBefore).to.eq(ethers.parseEther("0.991"));
        expect(totalStableAfter - totalStableBefore).to.eq(-ethers.parseUnits("1", 6));
        expect(yieldBalanceAfter - yieldBalanceBefore).to.eq(ethers.parseEther("0.991"));
        expect(stableBalanceAfter - stableBalanceBefore).to.eq(-ethers.parseUnits("1", 6));
        expect(callerYieldBalanceAfter - callerYieldBalanceBefore).to.eq(ethers.parseEther("1"));
        expect(callerStableBalanceAfter - callerStableBalanceBefore).to.eq(0n);
      });
    });
  });
});
