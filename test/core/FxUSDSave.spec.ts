/* eslint-disable camelcase */
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { MaxInt256, MaxUint256, MinInt256, ZeroAddress, ZeroHash } from "ethers";
import { ethers, network } from "hardhat";

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
  FxSaveRewarder,
  FxUSDSave,
  FxUSDSave__factory,
} from "@/types/index";
import { encodeChainlinkPriceFeed } from "@/utils/index";

const TokenRate = ethers.parseEther("1.23");

describe("FxUSDSave.spec", async () => {
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let platform: HardhatEthersSigner;

  let proxyAdmin: ProxyAdmin;
  let fxUSD: FxUSDRegeneracy;
  let stableToken: MockERC20;
  let collateralToken: MockERC20;
  let pegKeeper: PegKeeper;
  let poolManager: PoolManager;
  let reservePool: ReservePool;
  let sfxUSD: FxUSDSave;
  let sfxUSDRewarder: FxSaveRewarder;

  let mockAggregatorV3Interface: MockAggregatorV3Interface;
  let mockCurveStableSwapNG: MockCurveStableSwapNG;
  let mockPriceOracle: MockPriceOracle;
  let mockRateProvider: MockRateProvider;
  let mockAaveV3Pool: MockAaveV3Pool;

  let pool: AaveFundingPool;

  beforeEach(async () => {
    [deployer, admin, platform] = await ethers.getSigners();

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
    const FxUSDSave = await ethers.getContractFactory("FxUSDSave", deployer);
    const ReservePool = await ethers.getContractFactory("ReservePool", deployer);
    const FxSaveRewarder = await ethers.getContractFactory("FxSaveRewarder", deployer);
    const MultiPathConverter = await ethers.getContractFactory("MultiPathConverter", deployer);

    const empty = await EmptyContract.deploy();
    stableToken = await MockERC20.deploy("USDC", "USDC", 6);
    collateralToken = await MockERC20.deploy("X", "Y", 18);
    proxyAdmin = await ProxyAdmin.connect(admin).deploy();
    const converter = await MultiPathConverter.deploy(ZeroAddress);

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
    const FxUSDSaveProxy = await TransparentUpgradeableProxy.deploy(empty.getAddress(), proxyAdmin.getAddress(), "0x");

    // deploy ReservePool
    reservePool = await ReservePool.deploy(admin.address, PoolManagerProxy.getAddress());

    // deploy PoolManager
    const PoolManagerImpl = await PoolManager.deploy(
      FxUSDRegeneracyProxy.getAddress(),
      FxUSDSaveProxy.getAddress(),
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
        platform.address,
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

    // deploy FxUSDSave
    const FxUSDSaveImpl = await FxUSDSave.deploy(
      PoolManagerProxy.getAddress(),
      PegKeeperProxy.getAddress(),
      FxUSDRegeneracyProxy.getAddress(),
      stableToken.getAddress(),
      encodeChainlinkPriceFeed(await mockAggregatorV3Interface.getAddress(), 10n ** 10n, 1000000000)
    );
    await proxyAdmin.upgradeAndCall(
      FxUSDSaveProxy.getAddress(),
      FxUSDSaveImpl.getAddress(),
      FxUSDSave__factory.createInterface().encodeFunctionData("initialize", [
        admin.address,
        "Staked f(x) USD",
        "sfxUSD",
        ethers.parseEther("0.95"),
      ])
    );
    sfxUSD = await ethers.getContractAt("FxUSDSave", await FxUSDSaveProxy.getAddress(), admin);

    // deploy PegKeeper
    const PegKeeperImpl = await PegKeeper.deploy(sfxUSD.getAddress());
    await proxyAdmin.upgradeAndCall(
      PegKeeperProxy.getAddress(),
      PegKeeperImpl.getAddress(),
      PegKeeper__factory.createInterface().encodeFunctionData("initialize", [
        admin.address,
        await converter.getAddress(),
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

    sfxUSDRewarder = await FxSaveRewarder.deploy(sfxUSD.getAddress());
    await poolManager.registerPool(
      pool.getAddress(),
      sfxUSDRewarder.getAddress(),
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
      expect(await sfxUSD.name()).to.eq("Staked f(x) USD");
      expect(await sfxUSD.symbol()).to.eq("sfxUSD");

      expect(await sfxUSD.poolManager()).to.eq(await poolManager.getAddress());
      expect(await sfxUSD.pegKeeper()).to.eq(await pegKeeper.getAddress());
      expect(await sfxUSD.yieldToken()).to.eq(await fxUSD.getAddress());
      expect(await sfxUSD.stableToken()).to.eq(await stableToken.getAddress());

      expect(await sfxUSD.totalYieldToken()).to.eq(0n);
      expect(await sfxUSD.totalStableToken()).to.eq(0n);
      expect(await sfxUSD.stableDepegPrice()).to.eq(ethers.parseEther("0.95"));
    });

    it("should revert, when initialize again", async () => {
      await expect(sfxUSD.initialize(ZeroAddress, "", "", 0n)).to.revertedWithCustomError(
        pool,
        "InvalidInitialization"
      );
    });
  });

  context("auth", async () => {
    context("updateStableDepegPrice", async () => {});
  });

  context("deposit", async () => {
    beforeEach(async () => {
      await stableToken.mint(deployer.address, ethers.parseUnits("10000", 6));
      await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
      await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

      // open a position
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
      await poolManager
        .connect(deployer)
        .operate(pool.getAddress(), 0, ethers.parseEther("100"), ethers.parseEther("220000"));
    });

    it("should revert, when ErrInvalidTokenIn", async () => {
      await expect(sfxUSD.deposit(ZeroAddress, ZeroAddress, 0n, 0n)).to.revertedWithCustomError(
        sfxUSD,
        "ErrInvalidTokenIn"
      );
      await expect(sfxUSD.previewDeposit(ZeroAddress, 0n)).to.revertedWithCustomError(sfxUSD, "ErrInvalidTokenIn");
    });

    it("should revert, when ErrDepositZeroAmount", async () => {
      await expect(sfxUSD.deposit(ZeroAddress, fxUSD.getAddress(), 0n, 0n)).to.revertedWithCustomError(
        sfxUSD,
        "ErrDepositZeroAmount"
      );
    });

    it("should revert, when ErrorStableTokenDepeg", async () => {
      await fxUSD.connect(deployer).approve(sfxUSD.getAddress(), ethers.parseEther("1"));
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.95", 8) - 1n);
      expect(await sfxUSD.getStableTokenPrice()).to.eq((ethers.parseUnits("0.95", 8) - 1n) * 10n ** 10n);
      expect(await sfxUSD.getStableTokenPriceWithScale()).to.eq((ethers.parseUnits("0.95", 8) - 1n) * 10n ** 22n);
      await expect(
        sfxUSD.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("1"), 0n)
      ).to.revertedWithCustomError(sfxUSD, "ErrorStableTokenDepeg");
    });

    it("should revert, when ErrInsufficientSharesOut", async () => {
      await fxUSD.connect(deployer).approve(sfxUSD.getAddress(), ethers.parseEther("1"));
      await expect(
        sfxUSD
          .connect(deployer)
          .deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("1"), ethers.parseEther("1") + 1n)
      ).to.revertedWithCustomError(sfxUSD, "ErrInsufficientSharesOut");
    });

    context("first time", async () => {
      it("should succeed, when deposit with fxUSD", async () => {
        const amountIn = ethers.parseEther("1");
        await fxUSD.connect(deployer).approve(sfxUSD.getAddress(), amountIn);
        const shares = await sfxUSD.previewDeposit(fxUSD.getAddress(), amountIn);
        expect(shares).to.eq(ethers.parseEther("1"));

        await expect(sfxUSD.connect(deployer).deposit(admin.address, fxUSD.getAddress(), amountIn, shares))
          .to.emit(sfxUSD, "Deposit")
          .withArgs(deployer.address, admin.address, await fxUSD.getAddress(), amountIn, shares);
        expect(await sfxUSD.totalSupply()).to.eq(shares);
        expect(await sfxUSD.balanceOf(admin.address)).to.eq(shares);
        expect(await sfxUSD.totalYieldToken()).to.eq(amountIn);
        expect(await sfxUSD.nav()).to.eq(ethers.parseEther("1"));
        expect(await sfxUSD.totalStableToken()).to.eq(0n);
      });

      it("should succeed, when deposit with USDC", async () => {
        const amountIn = ethers.parseUnits("1", 6);
        await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.999", 8));
        await stableToken.connect(deployer).approve(sfxUSD.getAddress(), amountIn);
        const shares = await sfxUSD.previewDeposit(stableToken.getAddress(), amountIn);
        expect(shares).to.eq(ethers.parseEther("0.999"));

        await expect(sfxUSD.connect(deployer).deposit(admin.address, stableToken.getAddress(), amountIn, shares))
          .to.emit(sfxUSD, "Deposit")
          .withArgs(deployer.address, admin.address, await stableToken.getAddress(), amountIn, shares);
        expect(await sfxUSD.totalSupply()).to.eq(shares);
        expect(await sfxUSD.balanceOf(admin.address)).to.eq(shares);
        expect(await sfxUSD.totalYieldToken()).to.eq(0n);
        expect(await sfxUSD.totalStableToken()).to.eq(amountIn);
        expect(await sfxUSD.nav()).to.eq(ethers.parseEther("1"));
      });
    });

    context("second time", async () => {
      beforeEach(async () => {
        await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.999", 8));
        await fxUSD.connect(deployer).approve(sfxUSD.getAddress(), MaxUint256);
        await stableToken.connect(deployer).approve(sfxUSD.getAddress(), MaxUint256);

        await sfxUSD.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("100"), 0n);
        await sfxUSD
          .connect(deployer)
          .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("100", 6), 0n);
        expect(await sfxUSD.totalStableToken()).to.eq(ethers.parseUnits("100", 6));
        expect(await sfxUSD.totalYieldToken()).to.eq(ethers.parseEther("100"));
        expect(await sfxUSD.totalSupply()).to.eq(ethers.parseEther("199.9"));
        expect(await sfxUSD.nav()).to.eq(ethers.parseEther("1"));
      });

      it("should succeed, when deposit with fxUSD", async () => {
        const totalSharesBefore = await sfxUSD.totalSupply();
        const userSharesBefore = await sfxUSD.balanceOf(admin.address);
        const amountIn = ethers.parseEther("1");
        await fxUSD.connect(deployer).approve(sfxUSD.getAddress(), amountIn);
        const shares = await sfxUSD.previewDeposit(fxUSD.getAddress(), amountIn);
        expect(shares).to.eq(ethers.parseEther("1"));

        await expect(sfxUSD.connect(deployer).deposit(admin.address, fxUSD.getAddress(), amountIn, shares))
          .to.emit(sfxUSD, "Deposit")
          .withArgs(deployer.address, admin.address, await fxUSD.getAddress(), amountIn, shares);
        expect(await sfxUSD.totalSupply()).to.eq(totalSharesBefore + shares);
        expect(await sfxUSD.balanceOf(admin.address)).to.eq(userSharesBefore + shares);
        expect(await sfxUSD.totalYieldToken()).to.eq(amountIn + ethers.parseEther("100"));
        expect(await sfxUSD.nav()).to.eq(ethers.parseEther("1"));
        expect(await sfxUSD.totalStableToken()).to.eq(ethers.parseUnits("100", 6));
      });

      it("should succeed, when deposit with USDC", async () => {
        const totalSharesBefore = await sfxUSD.totalSupply();
        const userSharesBefore = await sfxUSD.balanceOf(admin.address);
        const amountIn = ethers.parseUnits("1", 6);
        await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.999", 8));
        await stableToken.connect(deployer).approve(sfxUSD.getAddress(), amountIn);
        const shares = await sfxUSD.previewDeposit(stableToken.getAddress(), amountIn);
        expect(shares).to.eq(ethers.parseEther("0.999"));

        await expect(sfxUSD.connect(deployer).deposit(admin.address, stableToken.getAddress(), amountIn, shares))
          .to.emit(sfxUSD, "Deposit")
          .withArgs(deployer.address, admin.address, await stableToken.getAddress(), amountIn, shares);
        expect(await sfxUSD.totalSupply()).to.eq(totalSharesBefore + shares);
        expect(await sfxUSD.balanceOf(admin.address)).to.eq(userSharesBefore + shares);
        expect(await sfxUSD.totalYieldToken()).to.eq(ethers.parseEther("100"));
        expect(await sfxUSD.totalStableToken()).to.eq(amountIn + ethers.parseUnits("100", 6));
        expect(await sfxUSD.nav()).to.eq(ethers.parseEther("1"));
      });

      context("index up", async () => {
        beforeEach(async () => {
          await sfxUSD.grantRole(await sfxUSD.REWARD_DEPOSITOR_ROLE(), deployer.address);
          await sfxUSD.connect(deployer).depositReward(ethers.parseEther("1"));
          const timestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
          await network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp) + 86400 * 7]);
          await sfxUSD.connect(deployer).depositReward(0n);
          expect(await sfxUSD.totalStableToken()).to.eq(ethers.parseUnits("100", 6));
          expect(await sfxUSD.totalYieldToken()).to.closeTo(ethers.parseEther("101"), 1000000n);
          expect(await sfxUSD.totalSupply()).to.eq(ethers.parseEther("199.9"));
          expect(await sfxUSD.nav()).to.closeTo(ethers.parseEther("1.005002501250625312"), 1000000n);
        });

        it("should succeed, when deposit with fxUSD", async () => {
          const totalSharesBefore = await sfxUSD.totalSupply();
          const userSharesBefore = await sfxUSD.balanceOf(admin.address);
          const amountIn = ethers.parseEther("1");
          await fxUSD.connect(deployer).approve(sfxUSD.getAddress(), amountIn);
          const shares = await sfxUSD.previewDeposit(fxUSD.getAddress(), amountIn);
          expect(shares).to.closeTo(ethers.parseEther("0.995022399203583873"), 1000000n);
          expect(
            await sfxUSD.connect(deployer).deposit.staticCall(admin.address, fxUSD.getAddress(), amountIn, shares)
          ).to.eq(shares);

          await expect(sfxUSD.connect(deployer).deposit(admin.address, fxUSD.getAddress(), amountIn, shares))
            .to.emit(sfxUSD, "Deposit")
            .withArgs(deployer.address, admin.address, await fxUSD.getAddress(), amountIn, shares);
          expect(await sfxUSD.totalSupply()).to.eq(totalSharesBefore + shares);
          expect(await sfxUSD.balanceOf(admin.address)).to.eq(userSharesBefore + shares);
          expect(await sfxUSD.totalYieldToken()).to.closeTo(amountIn + ethers.parseEther("101"), 1000000n);
          expect(await sfxUSD.nav()).to.closeTo(ethers.parseEther("1.005002501250625312"), 1000000n);
          expect(await sfxUSD.totalStableToken()).to.eq(ethers.parseUnits("100", 6));
        });

        it("should succeed, when deposit with USDC", async () => {
          const totalSharesBefore = await sfxUSD.totalSupply();
          const userSharesBefore = await sfxUSD.balanceOf(admin.address);
          const amountIn = ethers.parseUnits("1", 6);
          await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.999", 8));
          await stableToken.connect(deployer).approve(sfxUSD.getAddress(), amountIn);
          const shares = await sfxUSD.previewDeposit(stableToken.getAddress(), amountIn);
          expect(shares).to.closeTo(ethers.parseEther("0.994027376804380289"), 1000000n);
          expect(
            await sfxUSD.connect(deployer).deposit.staticCall(admin.address, stableToken.getAddress(), amountIn, shares)
          ).to.eq(shares);

          await expect(sfxUSD.connect(deployer).deposit(admin.address, stableToken.getAddress(), amountIn, shares))
            .to.emit(sfxUSD, "Deposit")
            .withArgs(deployer.address, admin.address, await stableToken.getAddress(), amountIn, shares);
          expect(await sfxUSD.totalSupply()).to.eq(totalSharesBefore + shares);
          expect(await sfxUSD.balanceOf(admin.address)).to.eq(userSharesBefore + shares);
          expect(await sfxUSD.totalYieldToken()).to.closeTo(ethers.parseEther("101"), 1000000n);
          expect(await sfxUSD.totalStableToken()).to.eq(amountIn + ethers.parseUnits("100", 6));
          expect(await sfxUSD.nav()).to.closeTo(ethers.parseEther("1.005002501250625312"), 1000000n);
        });
      });
    });
  });

  context("redeem", async () => {
    beforeEach(async () => {
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("1.001", 8));
      await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
      await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

      // open a position
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
      await poolManager
        .connect(deployer)
        .operate(pool.getAddress(), 0, ethers.parseEther("100"), ethers.parseEther("220000"));

      await stableToken.mint(deployer.address, ethers.parseUnits("220000", 6));
      await fxUSD.connect(deployer).approve(sfxUSD.getAddress(), MaxUint256);
      await stableToken.connect(deployer).approve(sfxUSD.getAddress(), MaxUint256);

      // deposit
      await sfxUSD.connect(deployer).deposit(deployer.address, fxUSD.getAddress(), ethers.parseEther("100"), 0n);
      await sfxUSD
        .connect(deployer)
        .deposit(deployer.address, stableToken.getAddress(), ethers.parseUnits("100", 6), 0n);

      // index up
      await sfxUSD.grantRole(await sfxUSD.REWARD_DEPOSITOR_ROLE(), deployer.address);
      await sfxUSD.connect(deployer).depositReward(ethers.parseEther("1"));
      const timestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp) + 86400 * 7]);
      await sfxUSD.connect(deployer).depositReward(0n);

      // check result
      expect(await sfxUSD.totalStableToken()).to.eq(ethers.parseUnits("100", 6));
      expect(await sfxUSD.totalYieldToken()).to.closeTo(ethers.parseEther("101"), 1000000n);
      expect(await sfxUSD.totalSupply()).to.eq(ethers.parseEther("200.1"));
      expect(await sfxUSD.balanceOf(deployer.address)).to.eq(ethers.parseEther("200.1"));
      expect(await sfxUSD.nav()).to.closeTo(ethers.parseEther("1.004997501249375312"), 1000000n);
    });

    it("should revert, when ErrRedeemZeroShares", async () => {
      await expect(sfxUSD.connect(deployer).redeem(deployer.address, 0n)).to.revertedWithCustomError(
        sfxUSD,
        "ErrRedeemZeroShares"
      );
    });

    it("should succeed when redeem to self", async () => {
      const sharesIn = ethers.parseEther("1");
      const [fxUSDOut, stableOut] = await sfxUSD.previewRedeem(sharesIn);
      expect(fxUSDOut).to.closeTo(ethers.parseEther(".504747626186906546"), 1000000n);
      expect(stableOut).to.closeTo(ethers.parseUnits(".499750", 6), 1n);
      expect(await sfxUSD.connect(deployer).redeem.staticCall(deployer.address, sharesIn)).to.deep.eq([
        fxUSDOut,
        stableOut,
      ]);

      const fxusdBefore = await fxUSD.balanceOf(deployer.address);
      const stableBefore = await stableToken.balanceOf(deployer.address);
      await expect(sfxUSD.connect(deployer).redeem(deployer.address, sharesIn))
        .to.emit(sfxUSD, "Redeem")
        .withArgs(deployer.address, deployer.address, sharesIn, fxUSDOut, stableOut);
      const fxusdAfter = await fxUSD.balanceOf(deployer.address);
      const stableAfter = await stableToken.balanceOf(deployer.address);
      expect(stableAfter - stableBefore).to.eq(stableOut);
      expect(fxusdAfter - fxusdBefore).to.eq(fxUSDOut);
      expect(await sfxUSD.totalSupply()).to.eq(ethers.parseEther("200.1") - sharesIn);
      expect(await sfxUSD.balanceOf(deployer.address)).to.eq(ethers.parseEther("200.1") - sharesIn);
      expect(await sfxUSD.totalStableToken()).to.eq(ethers.parseUnits("100", 6) - stableOut);
      expect(await sfxUSD.totalYieldToken()).to.closeTo(ethers.parseEther("101") - fxUSDOut, 1000000n);
      expect(await sfxUSD.nav()).to.closeTo(
        ethers.parseEther("1.004997501249375312"),
        ethers.parseEther("1.004997501249375312") / 1000000n
      );
    });

    it("should succeed when redeem to other", async () => {
      const sharesIn = ethers.parseEther("1");
      const [fxUSDOut, stableOut] = await sfxUSD.previewRedeem(sharesIn);
      expect(fxUSDOut).to.closeTo(ethers.parseEther(".504747626186906546"), 1000000n);
      expect(stableOut).to.closeTo(ethers.parseUnits(".499750", 6), 1n);
      expect(await sfxUSD.connect(deployer).redeem.staticCall(deployer.address, sharesIn)).to.deep.eq([
        fxUSDOut,
        stableOut,
      ]);

      const fxusdBefore = await fxUSD.balanceOf(admin.address);
      const stableBefore = await stableToken.balanceOf(admin.address);
      await expect(sfxUSD.connect(deployer).redeem(admin.address, sharesIn))
        .to.emit(sfxUSD, "Redeem")
        .withArgs(deployer.address, admin.address, sharesIn, fxUSDOut, stableOut);
      const fxusdAfter = await fxUSD.balanceOf(admin.address);
      const stableAfter = await stableToken.balanceOf(admin.address);
      expect(stableAfter - stableBefore).to.eq(stableOut);
      expect(fxusdAfter - fxusdBefore).to.eq(fxUSDOut);
      expect(await sfxUSD.totalSupply()).to.eq(ethers.parseEther("200.1") - sharesIn);
      expect(await sfxUSD.balanceOf(deployer.address)).to.eq(ethers.parseEther("200.1") - sharesIn);
      expect(await sfxUSD.totalStableToken()).to.eq(ethers.parseUnits("100", 6) - stableOut);
      expect(await sfxUSD.totalYieldToken()).to.closeTo(ethers.parseEther("101") - fxUSDOut, 1000000n);
      expect(await sfxUSD.nav()).to.closeTo(
        ethers.parseEther("1.004997501249375312"),
        ethers.parseEther("1.004997501249375312") / 1000000n
      );
    });
  });

  context("rebalance on tick", async () => {
    beforeEach(async () => {
      await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.991", 8));
      await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
      await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

      // remove open fee
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));

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
  });

  context("rebalance on position", async () => {});

  context("liquidate on position", async () => {});

  context("arbitrage", async () => {});
});
