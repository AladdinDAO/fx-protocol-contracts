/* eslint-disable camelcase */
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { id, MaxUint256, MinInt256, ZeroAddress, ZeroHash } from "ethers";
import { ethers, network } from "hardhat";

import {
  AaveFundingPool,
  FxUSDRegeneracy,
  MockAaveV3Pool,
  MockAggregatorV3Interface,
  MockCurveStableSwapNG,
  MockERC20,
  MockPriceOracle,
  PegKeeper,
  PegKeeper__factory,
  PoolManager,
  PoolManager__factory,
  ProxyAdmin,
  ReservePool,
  FxUSDBasePool,
  FxUSDBasePool__factory,
  GaugeRewarder,
} from "@/types/index";
import { encodeChainlinkPriceFeed } from "@/utils/index";
import { mockETHBalance, unlockAccounts } from "@/test/utils";

describe("AaveFundingPool.spec", async () => {
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
  let fxBASERewarder: GaugeRewarder;

  let mockAggregatorV3Interface: MockAggregatorV3Interface;
  let mockCurveStableSwapNG: MockCurveStableSwapNG;
  let mockPriceOracle: MockPriceOracle;
  let mockAaveV3Pool: MockAaveV3Pool;

  let pool: AaveFundingPool;

  beforeEach(async () => {
    [deployer, admin, treasury, revenuePool] = await ethers.getSigners();

    const MockAggregatorV3Interface = await ethers.getContractFactory("MockAggregatorV3Interface", deployer);
    const MockCurveStableSwapNG = await ethers.getContractFactory("MockCurveStableSwapNG", deployer);
    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle", deployer);
    const MockAaveV3Pool = await ethers.getContractFactory("MockAaveV3Pool", deployer);

    mockAggregatorV3Interface = await MockAggregatorV3Interface.deploy(8, ethers.parseUnits("1", 8));
    mockCurveStableSwapNG = await MockCurveStableSwapNG.deploy();
    mockPriceOracle = await MockPriceOracle.deploy(
      ethers.parseEther("3000"),
      ethers.parseEther("2999"),
      ethers.parseEther("3001")
    );
    mockAaveV3Pool = await MockAaveV3Pool.deploy(ethers.parseUnits("0.05", 27));
    await mockAaveV3Pool.setReserveNormalizedVariableDebt(ethers.parseUnits("1", 27));

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
        "fxUSD Base Pool Token",
        "fxUSDBase",
        ethers.parseEther("0.995"),
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

    fxBASERewarder = await GaugeRewarder.deploy(fxBASE.getAddress());
    await poolManager.registerPool(
      pool.getAddress(),
      fxBASERewarder.getAddress(),
      ethers.parseEther("10000"),
      ethers.parseEther("10000000")
    );
    await mockCurveStableSwapNG.setCoin(0, stableToken.getAddress());
    await mockCurveStableSwapNG.setCoin(1, fxUSD.getAddress());
    await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("1"));
  });

  context("constructor", async () => {
    it("should initialize correctly", async () => {
      expect(await pool.fxUSD()).to.eq(await fxUSD.getAddress());
      expect(await pool.poolManager()).to.eq(await poolManager.getAddress());
      expect(await pool.pegKeeper()).to.eq(await pegKeeper.getAddress());

      expect(await pool.collateralToken()).to.eq(await collateralToken.getAddress());
      expect(await pool.priceOracle()).to.eq(await mockPriceOracle.getAddress());

      expect(await pool.isBorrowPaused()).to.eq(false);
      expect(await pool.isRedeemPaused()).to.eq(false);
      expect(await pool.getTopTick()).to.eq(-32768);
      expect(await pool.getNextPositionId()).to.eq(1);
      expect(await pool.getNextTreeNodeId()).to.eq(1);
      expect(await pool.getDebtRatioRange()).to.deep.eq([500000000000000000n, 857142857142857142n]);
      expect(await pool.getMaxRedeemRatioPerTick()).to.eq(ethers.parseUnits("0.2", 9));
      expect(await pool.getRebalanceRatios()).to.deep.eq([ethers.parseEther("0.88"), ethers.parseUnits("0.025", 9)]);
      expect(await pool.getLiquidateRatios()).to.deep.eq([ethers.parseEther("0.92"), ethers.parseUnits("0.05", 9)]);
      expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
      expect(await pool.getDebtAndCollateralShares()).to.deep.eq([0n, 0n]);
      expect(await pool.getTotalRawCollaterals()).to.eq(0n);
      expect(await pool.getFundingRatio()).to.eq(0n);
      expect(await pool.getOpenFeeRatio()).to.eq(ethers.parseUnits("0.001", 9));
      expect(await pool.getCloseFeeRatio()).to.eq(ethers.parseUnits("0.001", 9));

      expect((await pool.borrowRateSnapshot()).lastInterestRate).to.eq(ethers.parseUnits("0.05", 18));
      expect((await pool.borrowRateSnapshot()).borrowIndex).to.eq(ethers.parseUnits("1", 27));
      expect((await pool.borrowRateSnapshot()).timestamp).to.gt(0);
    });

    it("should revert, when initialize again", async () => {
      await expect(pool.initialize(ZeroAddress, "", "", ZeroAddress, ZeroAddress)).to.revertedWithCustomError(
        pool,
        "InvalidInitialization"
      );
    });
  });

  context("auth", async () => {
    context("updateBorrowAndRedeemStatus", async () => {
      it("should revert, when caller is not dao", async () => {
        await expect(pool.connect(deployer).updateBorrowAndRedeemStatus(false, false))
          .to.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, id("EMERGENCY_ROLE"));
      });

      it("should succeed", async () => {
        await pool.connect(admin).grantRole(id("EMERGENCY_ROLE"), admin.address);
        expect(await pool.isBorrowPaused()).to.eq(false);
        expect(await pool.isRedeemPaused()).to.eq(false);
        await expect(pool.connect(admin).updateBorrowAndRedeemStatus(false, true))
          .to.emit(pool, "UpdateBorrowStatus")
          .withArgs(false)
          .to.emit(pool, "UpdateRedeemStatus")
          .withArgs(true);
        expect(await pool.isBorrowPaused()).to.eq(false);
        expect(await pool.isRedeemPaused()).to.eq(true);
        await expect(pool.connect(admin).updateBorrowAndRedeemStatus(true, true))
          .to.emit(pool, "UpdateBorrowStatus")
          .withArgs(true)
          .to.emit(pool, "UpdateRedeemStatus")
          .withArgs(true);
        expect(await pool.isBorrowPaused()).to.eq(true);
        expect(await pool.isRedeemPaused()).to.eq(true);
        await expect(pool.connect(admin).updateBorrowAndRedeemStatus(true, false))
          .to.emit(pool, "UpdateBorrowStatus")
          .withArgs(true)
          .to.emit(pool, "UpdateRedeemStatus")
          .withArgs(false);
        expect(await pool.isBorrowPaused()).to.eq(true);
        expect(await pool.isRedeemPaused()).to.eq(false);
        await expect(pool.connect(admin).updateBorrowAndRedeemStatus(false, false))
          .to.emit(pool, "UpdateBorrowStatus")
          .withArgs(false)
          .to.emit(pool, "UpdateRedeemStatus")
          .withArgs(false);
        expect(await pool.isBorrowPaused()).to.eq(false);
        expect(await pool.isRedeemPaused()).to.eq(false);
      });
    });

    context("updateDebtRatioRange", async () => {
      it("should revert, when caller is not admin", async () => {
        await expect(pool.connect(deployer).updateDebtRatioRange(0, 0))
          .to.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed", async () => {
        await expect(pool.connect(admin).updateDebtRatioRange(1, 0)).to.revertedWithCustomError(
          pool,
          "ErrorValueTooLarge"
        );
        await expect(pool.connect(admin).updateDebtRatioRange(0, 10n ** 18n + 1n)).to.revertedWithCustomError(
          pool,
          "ErrorValueTooLarge"
        );
        expect(await pool.getDebtRatioRange()).to.deep.eq([500000000000000000n, 857142857142857142n]);
        await expect(pool.connect(admin).updateDebtRatioRange(1n, 2n))
          .to.emit(pool, "UpdateDebtRatioRange")
          .withArgs(1n, 2n);
        expect(await pool.getDebtRatioRange()).to.deep.eq([1n, 2n]);
      });
    });

    context("updateMaxRedeemRatioPerTick", async () => {
      it("should revert, when caller is not admin", async () => {
        await expect(pool.connect(deployer).updateMaxRedeemRatioPerTick(0))
          .to.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed", async () => {
        await expect(pool.connect(admin).updateMaxRedeemRatioPerTick(10n ** 9n + 1n)).to.revertedWithCustomError(
          pool,
          "ErrorValueTooLarge"
        );
        expect(await pool.getMaxRedeemRatioPerTick()).to.eq(ethers.parseUnits("0.2", 9));
        await expect(pool.connect(admin).updateMaxRedeemRatioPerTick(1n))
          .to.emit(pool, "UpdateMaxRedeemRatioPerTick")
          .withArgs(1n);
        expect(await pool.getMaxRedeemRatioPerTick()).to.eq(1n);
      });
    });

    context("updateRebalanceRatios", async () => {
      it("should revert, when caller is not admin", async () => {
        await expect(pool.connect(deployer).updateRebalanceRatios(0, 0))
          .to.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed", async () => {
        await expect(pool.connect(admin).updateRebalanceRatios(10n ** 18n + 1n, 0)).to.revertedWithCustomError(
          pool,
          "ErrorValueTooLarge"
        );
        await expect(pool.connect(admin).updateRebalanceRatios(0, 10n ** 9n + 1n)).to.revertedWithCustomError(
          pool,
          "ErrorValueTooLarge"
        );
        expect(await pool.getRebalanceRatios()).to.deep.eq([ethers.parseEther("0.88"), ethers.parseUnits("0.025", 9)]);
        await expect(pool.connect(admin).updateRebalanceRatios(1n, 2n))
          .to.emit(pool, "UpdateRebalanceRatios")
          .withArgs(1n, 2n);
        expect(await pool.getRebalanceRatios()).to.deep.eq([1n, 2n]);
      });
    });

    context("updateLiquidateRatios", async () => {
      it("should revert, when caller is not admin", async () => {
        await expect(pool.connect(deployer).updateLiquidateRatios(0, 0))
          .to.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed", async () => {
        await expect(pool.connect(admin).updateLiquidateRatios(10n ** 18n + 1n, 0)).to.revertedWithCustomError(
          pool,
          "ErrorValueTooLarge"
        );
        await expect(pool.connect(admin).updateLiquidateRatios(0, 10n ** 9n + 1n)).to.revertedWithCustomError(
          pool,
          "ErrorValueTooLarge"
        );
        expect(await pool.getLiquidateRatios()).to.deep.eq([ethers.parseEther("0.92"), ethers.parseUnits("0.05", 9)]);
        await expect(pool.connect(admin).updateLiquidateRatios(1n, 2n))
          .to.emit(pool, "UpdateLiquidateRatios")
          .withArgs(1n, 2n);
        expect(await pool.getLiquidateRatios()).to.deep.eq([1n, 2n]);
      });
    });

    context("updatePriceOracle", async () => {
      it("should revert, when caller is not admin", async () => {
        await expect(pool.connect(deployer).updatePriceOracle(ZeroAddress))
          .to.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed", async () => {
        await expect(pool.connect(admin).updatePriceOracle(ZeroAddress)).to.revertedWithCustomError(
          pool,
          "ErrorZeroAddress"
        );

        expect(await pool.priceOracle()).to.eq(await mockPriceOracle.getAddress());
        await expect(pool.connect(admin).updatePriceOracle(deployer.address))
          .to.emit(pool, "UpdatePriceOracle")
          .withArgs(await mockPriceOracle.getAddress(), deployer.address);
        expect(await pool.priceOracle()).to.eq(deployer.address);
      });
    });

    context("updateOpenRatio", async () => {
      it("should revert, when caller is not admin", async () => {
        await expect(pool.connect(deployer).updateOpenRatio(0, 0))
          .to.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed", async () => {
        await expect(pool.connect(admin).updateOpenRatio(10n ** 9n + 1n, 0)).to.revertedWithCustomError(
          pool,
          "ErrorValueTooLarge"
        );
        await expect(pool.connect(admin).updateOpenRatio(0, 10n ** 18n + 1n)).to.revertedWithCustomError(
          pool,
          "ErrorValueTooLarge"
        );
        expect(await pool.getOpenRatio()).to.deep.eq([ethers.parseUnits("0.001", 9), ethers.parseEther("0.05")]);
        await expect(pool.connect(admin).updateOpenRatio(1n, 2n)).to.emit(pool, "UpdateOpenRatio").withArgs(1n, 2n);
        expect(await pool.getOpenRatio()).to.deep.eq([1n, 2n]);
      });

      it("should succeed for getOpenFeeRatio", async () => {
        await unlockAccounts([await poolManager.getAddress()]);
        const signer = await ethers.getSigner(await poolManager.getAddress());
        await mockETHBalance(signer.address, ethers.parseEther("100"));

        await pool.updateOpenRatio(ethers.parseUnits("0.001", 9), ethers.parseEther("0.05"));

        const lastTimestamp = Number((await pool.borrowRateSnapshot()).timestamp);
        // < 30 minutes, use last interest = 5%
        await network.provider.send("evm_setNextBlockTimestamp", [lastTimestamp + 60]);
        await mockAaveV3Pool.setReserveNormalizedVariableDebt(ethers.parseUnits("1.1", 27));
        await pool.connect(signer).operate(0, ethers.parseEther("1"), ethers.parseEther("2000"), deployer.address);
        expect(await pool.getOpenFeeRatio()).to.eq(ethers.parseUnits("0.001", 9));
        expect((await pool.borrowRateSnapshot()).timestamp).to.eq(lastTimestamp);
        await network.provider.send("evm_setNextBlockTimestamp", [lastTimestamp + 60 * 2]);
        await mockAaveV3Pool.setReserveNormalizedVariableDebt(ethers.parseUnits("1.2", 27));
        await pool.connect(signer).operate(0, ethers.parseEther("1"), ethers.parseEther("2000"), deployer.address);
        expect(await pool.getOpenFeeRatio()).to.eq(ethers.parseUnits("0.001", 9));
        expect((await pool.borrowRateSnapshot()).timestamp).to.eq(lastTimestamp);

        // = 30, use ((newBorrowIndex - prevBorrowIndex) * 365 days) / (prevBorrowIndex * duration)
        // increase 0.01%, apr is 175.2%, open fee multiple is (1.752 - eps) / 0.05 = 35
        await mockAaveV3Pool.setReserveNormalizedVariableDebt(ethers.parseUnits("1.0001", 27));
        await network.provider.send("evm_setNextBlockTimestamp", [lastTimestamp + 60 * 30]);
        await pool.connect(signer).operate(0, ethers.parseEther("1"), ethers.parseEther("2000"), deployer.address);
        expect(await pool.getOpenFeeRatio()).to.eq(ethers.parseUnits("0.035", 9));
        expect((await pool.borrowRateSnapshot()).timestamp).to.eq(lastTimestamp + 60 * 30);
        expect((await pool.borrowRateSnapshot()).lastInterestRate).to.eq(ethers.parseEther("1.752"));
        expect((await pool.borrowRateSnapshot()).borrowIndex).to.eq(ethers.parseUnits("1.0001", 27));
        // > 30, use ((newBorrowIndex - prevBorrowIndex) * 365 days) / (prevBorrowIndex * duration)
        // increase 0.01%, apr is 174.9880505845086967%, open fee multiple is (1.752 - eps) / 0.05 = 34
        await mockAaveV3Pool.setReserveNormalizedVariableDebt(ethers.parseUnits("1.0002", 27));
        await network.provider.send("evm_setNextBlockTimestamp", [lastTimestamp + 60 * 60 + 2]);
        await pool.connect(signer).operate(0, ethers.parseEther("1"), ethers.parseEther("2000"), deployer.address);
        expect(await pool.getOpenFeeRatio()).to.eq(ethers.parseUnits("0.034", 9));
        expect((await pool.borrowRateSnapshot()).timestamp).to.eq(lastTimestamp + 60 * 60 + 2);
        expect((await pool.borrowRateSnapshot()).lastInterestRate).to.eq(ethers.parseEther("1.749880505845086967"));
        expect((await pool.borrowRateSnapshot()).borrowIndex).to.eq(ethers.parseUnits("1.0002", 27));
      });
    });

    context("updateCloseFeeRatio", async () => {
      it("should revert, when caller is not admin", async () => {
        await expect(pool.connect(deployer).updateCloseFeeRatio(0))
          .to.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed", async () => {
        await expect(pool.connect(admin).updateCloseFeeRatio(10n ** 9n + 1n)).to.revertedWithCustomError(
          pool,
          "ErrorValueTooLarge"
        );
        expect(await pool.getCloseFeeRatio()).to.eq(ethers.parseUnits("0.001", 9));
        await expect(pool.connect(admin).updateCloseFeeRatio(1n))
          .to.emit(pool, "UpdateCloseFeeRatio")
          .withArgs(ethers.parseUnits("0.001", 9), 1n);
        expect(await pool.getCloseFeeRatio()).to.eq(1n);
      });
    });

    context("updateFundingRatio", async () => {
      it("should revert, when caller is not admin", async () => {
        await expect(pool.connect(deployer).updateFundingRatio(0))
          .to.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed", async () => {
        await expect(pool.connect(admin).updateFundingRatio(4294967295n + 1n)).to.revertedWithCustomError(
          pool,
          "ErrorValueTooLarge"
        );
        expect(await pool.getFundingRatio()).to.eq(0n);
        await expect(pool.connect(admin).updateFundingRatio(1n)).to.emit(pool, "UpdateFundingRatio").withArgs(0n, 1n);
        expect(await pool.getFundingRatio()).to.eq(1n);
      });
    });
  });

  context("operate", async () => {
    let signer: HardhatEthersSigner;

    beforeEach(async () => {
      await unlockAccounts([await poolManager.getAddress()]);
      signer = await ethers.getSigner(await poolManager.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));
    });

    it("should revert, when ErrorCallerNotPoolManager", async () => {
      await expect(pool.connect(deployer).operate(0, 0, 0, deployer.address)).to.revertedWithCustomError(
        pool,
        "ErrorCallerNotPoolManager"
      );
    });

    it("should revert, when ErrorNoSupplyAndNoBorrow", async () => {
      await expect(pool.connect(signer).operate(0, 0n, 0n, deployer.address)).to.revertedWithCustomError(
        pool,
        "ErrorNoSupplyAndNoBorrow"
      );
    });

    it("should revert, when ErrorCollateralTooSmall", async () => {
      await expect(pool.connect(signer).operate(0, 999999999n, 0n, deployer.address)).to.revertedWithCustomError(
        pool,
        "ErrorCollateralTooSmall"
      );
      await expect(pool.connect(signer).operate(0, -999999999n, 0n, deployer.address)).to.revertedWithCustomError(
        pool,
        "ErrorCollateralTooSmall"
      );
    });

    it("should revert, when ErrorDebtTooSmall", async () => {
      await expect(pool.connect(signer).operate(0, 0n, 999999999n, deployer.address)).to.revertedWithCustomError(
        pool,
        "ErrorDebtTooSmall"
      );
      await expect(pool.connect(signer).operate(0, 0n, -999999999n, deployer.address)).to.revertedWithCustomError(
        pool,
        "ErrorDebtTooSmall"
      );
    });

    it("should revert, when ErrorBorrowPaused", async () => {
      await pool.connect(admin).grantRole(id("EMERGENCY_ROLE"), admin.address);
      // pool borrow paused, peg keeper borrow allowed
      await pool.connect(admin).updateBorrowAndRedeemStatus(true, false);
      expect(await pool.isBorrowPaused()).to.eq(true);
      expect(await pegKeeper.isBorrowAllowed()).to.eq(true);
      await expect(pool.connect(signer).operate(0, 0n, 10n ** 9n, deployer.address)).to.revertedWithCustomError(
        pool,
        "ErrorBorrowPaused"
      );
      // pool borrow not paused, peg keeper borrow not allowed
      await pool.connect(admin).updateBorrowAndRedeemStatus(false, false);
      await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.9"));
      expect(await pool.isBorrowPaused()).to.eq(false);
      expect(await pegKeeper.isBorrowAllowed()).to.eq(false);
      await expect(pool.connect(signer).operate(0, 0n, 10n ** 9n, deployer.address)).to.revertedWithCustomError(
        pool,
        "ErrorBorrowPaused"
      );
      // pool borrow paused, peg keeper borrow not allowed
      await pool.connect(admin).updateBorrowAndRedeemStatus(true, false);
      await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.9"));
      expect(await pool.isBorrowPaused()).to.eq(true);
      expect(await pegKeeper.isBorrowAllowed()).to.eq(false);
      await expect(pool.connect(signer).operate(0, 0n, 10n ** 9n, deployer.address)).to.revertedWithCustomError(
        pool,
        "ErrorBorrowPaused"
      );
    });

    it("should revert, when ErrorDebtRatioTooLarge", async () => {
      await pool.updateOpenRatio(0n, 1n);
      // current price is 2999, max allow to borrow is
      await expect(
        pool
          .connect(signer)
          .operate(0, ethers.parseEther("1.23"), ethers.parseEther("3161.802857142857139696"), deployer.address)
      ).to.revertedWithCustomError(pool, "ErrorDebtRatioTooLarge");
    });

    it("should revert, when ErrorDebtRatioTooSmall", async () => {
      await pool.updateOpenRatio(0n, 1n);
      // current price is 2999, max allow to borrow is
      await expect(
        pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("1844.384"), deployer.address)
      ).to.revertedWithCustomError(pool, "ErrorDebtRatioTooSmall");
    });

    it("should succeed when open a new position", async () => {
      const newRawColl = ethers.parseEther("1.23");
      const protocolFees = newRawColl / 1000n;
      const result = await pool
        .connect(signer)
        .operate.staticCall(0, newRawColl, ethers.parseEther("2000"), deployer.address);
      expect(result[0]).to.eq(1); // positionId
      expect(result[1]).to.eq(newRawColl - protocolFees); // raw collaterals after fee
      expect(result[2]).to.eq(ethers.parseEther("2000")); // raw debts
      expect(result[3]).to.eq(protocolFees); // protocol fee
      await expect(pool.connect(signer).operate(0, newRawColl, ethers.parseEther("2000"), deployer.address))
        .to.emit(pool, "PositionSnapshot")
        .withArgs(1, 4934, newRawColl - protocolFees, ethers.parseEther("2000"), ethers.parseEther("2999"));
      expect(await pool.ownerOf(1)).to.eq(deployer.address);
      expect(await pool.getPosition(1)).to.deep.eq([newRawColl - protocolFees, ethers.parseEther("2000")]);
      expect(await pool.getNextPositionId()).to.eq(2);
      expect(await pool.getNextTreeNodeId()).to.eq(2);
      expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
      expect(await pool.getDebtAndCollateralShares()).to.deep.eq([
        ethers.parseEther("2000"),
        newRawColl - protocolFees,
      ]);
      expect(await pool.getTopTick()).to.eq((await pool.positionData(1)).tick);

      await expect(
        pool.connect(signer).operate(1, newRawColl - protocolFees, ethers.parseEther("2000"), signer.address)
      ).to.revertedWithCustomError(pool, "ErrorNotPositionOwner");
    });

    it("should succeed, operate on multiple new positions", async () => {
      const newRawColl = ethers.parseEther("1.23");
      const protocolFees = newRawColl / 1000n;
      const result = await pool
        .connect(signer)
        .operate.staticCall(0, newRawColl, ethers.parseEther("2000"), deployer.address);
      expect(result[0]).to.eq(1); // positionId
      expect(result[1]).to.eq(newRawColl - protocolFees); // raw collaterals after fee
      expect(result[2]).to.eq(ethers.parseEther("2000")); // raw debts
      expect(result[3]).to.eq(protocolFees); // protocol fee
      await expect(pool.connect(signer).operate(0, newRawColl, ethers.parseEther("2000"), deployer.address))
        .to.emit(pool, "PositionSnapshot")
        .withArgs(1, 4934, newRawColl - protocolFees, ethers.parseEther("2000"), ethers.parseEther("2999"));
      expect(await pool.ownerOf(1)).to.eq(deployer.address);
      expect(await pool.getPosition(1)).to.deep.eq([newRawColl - protocolFees, ethers.parseEther("2000")]);
      expect(await pool.getNextPositionId()).to.eq(2);
      expect(await pool.getNextTreeNodeId()).to.eq(2);
      expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
      expect(await pool.getDebtAndCollateralShares()).to.deep.eq([
        ethers.parseEther("2000"),
        newRawColl - protocolFees,
      ]);
      expect(await pool.getTopTick()).to.eq((await pool.positionData(1)).tick);
      // another position in same tick, top tick not change
      await expect(pool.connect(signer).operate(0, newRawColl, ethers.parseEther("2000"), deployer.address))
        .to.emit(pool, "PositionSnapshot")
        .withArgs(2, 4934, newRawColl - protocolFees, ethers.parseEther("2000"), ethers.parseEther("2999"));
      expect(await pool.ownerOf(2)).to.eq(deployer.address);
      expect(await pool.getPosition(2)).to.deep.eq([newRawColl - protocolFees, ethers.parseEther("2000")]);
      expect(await pool.getNextPositionId()).to.eq(3);
      expect(await pool.getNextTreeNodeId()).to.eq(2);
      expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
      expect(await pool.getDebtAndCollateralShares()).to.deep.eq([
        ethers.parseEther("4000"),
        (newRawColl - protocolFees) * 2n,
      ]);
      expect(await pool.getTotalRawCollaterals()).to.eq((newRawColl - protocolFees) * 2n);
      expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("2000") * 2n);
      expect((await pool.positionData(2)).tick).to.eq((await pool.positionData(1)).tick);
      expect(await pool.getTopTick()).to.eq((await pool.positionData(1)).tick);
      // another position in with smaller tick, top tick not change
      await expect(pool.connect(signer).operate(0, newRawColl, ethers.parseEther("1900"), deployer.address))
        .to.emit(pool, "PositionSnapshot")
        .withArgs(3, 4900, newRawColl - protocolFees, ethers.parseEther("1900"), ethers.parseEther("2999"));
      expect(await pool.ownerOf(3)).to.eq(deployer.address);
      expect(await pool.getPosition(3)).to.deep.eq([newRawColl - protocolFees, ethers.parseEther("1900")]);
      expect(await pool.getNextPositionId()).to.eq(4);
      expect(await pool.getNextTreeNodeId()).to.eq(3);
      expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
      expect(await pool.getDebtAndCollateralShares()).to.deep.eq([
        ethers.parseEther("5900"),
        (newRawColl - protocolFees) * 3n,
      ]);
      expect(await pool.getTotalRawCollaterals()).to.eq((newRawColl - protocolFees) * 3n);
      expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("5900"));
      expect((await pool.positionData(3)).tick).to.lt((await pool.positionData(1)).tick);
      expect(await pool.getTopTick()).to.eq((await pool.positionData(1)).tick);
      // another position in with larger tick, top tick change
      await expect(pool.connect(signer).operate(0, newRawColl, ethers.parseEther("2100"), deployer.address))
        .to.emit(pool, "PositionSnapshot")
        .withArgs(4, 4967, newRawColl - protocolFees, ethers.parseEther("2100"), ethers.parseEther("2999"));
      expect(await pool.ownerOf(4)).to.eq(deployer.address);
      expect(await pool.getPosition(4)).to.deep.eq([newRawColl - protocolFees, ethers.parseEther("2100")]);
      expect(await pool.getNextPositionId()).to.eq(5);
      expect(await pool.getNextTreeNodeId()).to.eq(4);
      expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
      expect(await pool.getDebtAndCollateralShares()).to.deep.eq([
        ethers.parseEther("8000"),
        (newRawColl - protocolFees) * 4n,
      ]);
      expect(await pool.getTotalRawCollaterals()).to.eq((newRawColl - protocolFees) * 4n);
      expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("8000"));
      expect((await pool.positionData(4)).tick).to.gt((await pool.positionData(1)).tick);
      expect(await pool.getTopTick()).to.eq((await pool.positionData(4)).tick);
    });

    context("funding costs", async () => {
      const InitialRawCollateral = ethers.parseEther("1.23") - ethers.parseEther("1.23") / 1000n;
      beforeEach(async () => {
        expect(
          await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2000"), deployer.address)
        ).to.to.emit(pool, "PositionSnapshot");
      });

      it("should charge no funding, when not enable", async () => {
        expect(await pegKeeper.isFundingEnabled()).to.eq(false);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
        await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2000"), deployer.address);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
      });

      it("should charge no funding, when enabled and funding ratio is zero", async () => {
        const [borrowIndex, lastRate, startTime] = await pool.borrowRateSnapshot();
        await network.provider.send("evm_setNextBlockTimestamp", [Number(startTime) + 86400 * 7]);
        await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.8"));
        expect(await pegKeeper.isFundingEnabled()).to.eq(true);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
        await pool.connect(signer).operate(1, ethers.parseEther("0.01"), 0n, deployer.address);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
      });

      it("should charge funding fee, when enable", async () => {
        expect(await pool.getTotalRawCollaterals()).to.eq(InitialRawCollateral);
        await pool.updateFundingRatio(ethers.parseUnits("0.1", 9));
        const [borrowIndex, lastRate, startTime] = await pool.borrowRateSnapshot();
        await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.8"));
        expect(await pegKeeper.isFundingEnabled()).to.eq(true);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
        await network.provider.send("evm_setNextBlockTimestamp", [Number(startTime) + 86400 * 7]);
        await pool.connect(signer).operate(1, ethers.parseEther("0.01"), 0n, deployer.address);
        const timestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
        const funding =
          (InitialRawCollateral * lastRate * (BigInt(timestamp) - startTime)) / (86400n * 365n * 10n ** 18n) / 10n;
        // 1.22877 * 0.05 * 7 / 365 * 0.1 = 0.000117827260273972
        expect(funding).to.eq(ethers.parseEther(".000117827260273972"));
        // 1.23 - 1.23 / 1000 + 0.01 - 0.01 / 1000 - 0.000117827260273972 = 1.238642172739726028
        expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("1.238642172739726028"), 10);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 79235760463897862007198239823n]);
      });
    });

    context("operate on old position", async () => {
      const InitialRawCollateral = ethers.parseEther("1.23") - ethers.parseEther("1.23") / 1000n;
      const InitialRawDebt = ethers.parseEther("2000");

      beforeEach(async () => {
        expect(
          await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2000"), deployer.address)
        ).to.to.emit(pool, "PositionSnapshot");
      });

      it("should succeed to add collateral", async () => {
        const rawColl = ethers.parseEther("0.01");
        expect(await pool.connect(signer).operate(1, rawColl, 0n, deployer.address)).to.emit(pool, "PositionSnapshot");
        expect(await pool.ownerOf(1)).to.eq(deployer.address);
        expect(await pool.getPosition(1)).to.deep.eq([
          InitialRawCollateral + rawColl - rawColl / 1000n,
          InitialRawDebt,
        ]);
        expect(await pool.getNextPositionId()).to.eq(2);
        expect(await pool.getNextTreeNodeId()).to.eq(3);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
        expect(await pool.getDebtAndCollateralShares()).to.deep.eq([
          InitialRawDebt,
          InitialRawCollateral + rawColl - rawColl / 1000n,
        ]);
      });

      it("should succeed to remove collateral", async () => {
        const rawColl = ethers.parseEther("0.01");
        expect(await pool.connect(signer).operate(1, -rawColl, 0n, deployer.address)).to.emit(pool, "PositionSnapshot");
        expect(await pool.ownerOf(1)).to.eq(deployer.address);
        expect(await pool.getPosition(1)).to.deep.eq([InitialRawCollateral - rawColl, InitialRawDebt]);
        expect(await pool.getNextPositionId()).to.eq(2);
        expect(await pool.getNextTreeNodeId()).to.eq(3);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
        expect(await pool.getDebtAndCollateralShares()).to.deep.eq([InitialRawDebt, InitialRawCollateral - rawColl]);

        await expect(
          pool.connect(signer).operate(1, -InitialRawCollateral * 2n, 0n, deployer.address)
        ).to.revertedWithCustomError(pool, "ErrorWithdrawExceedSupply");
      });

      it("should succeed to borrow debt", async () => {
        const rawDebt = ethers.parseEther("100");
        expect(await pool.connect(signer).operate(1, 0n, rawDebt, deployer.address)).to.emit(pool, "PositionSnapshot");
        expect(await pool.ownerOf(1)).to.eq(deployer.address);
        expect(await pool.getPosition(1)).to.deep.eq([InitialRawCollateral, InitialRawDebt + rawDebt]);
        expect(await pool.getNextPositionId()).to.eq(2);
        expect(await pool.getNextTreeNodeId()).to.eq(3);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
        expect(await pool.getDebtAndCollateralShares()).to.deep.eq([InitialRawDebt + rawDebt, InitialRawCollateral]);
      });

      it("should succeed to repay debt", async () => {
        const rawDebt = ethers.parseEther("100");
        expect(await pool.connect(signer).operate(1, 0n, -rawDebt, deployer.address)).to.emit(pool, "PositionSnapshot");
        expect(await pool.ownerOf(1)).to.eq(deployer.address);
        expect(await pool.getPosition(1)).to.deep.eq([InitialRawCollateral, InitialRawDebt - rawDebt]);
        expect(await pool.getNextPositionId()).to.eq(2);
        expect(await pool.getNextTreeNodeId()).to.eq(3);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
        expect(await pool.getDebtAndCollateralShares()).to.deep.eq([InitialRawDebt - rawDebt, InitialRawCollateral]);
      });

      it("should succeed close entire position", async () => {
        // open another one to avoid ErrorPoolUnderCollateral
        await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2000"), deployer.address);
        await pool.connect(signer).operate(1, MinInt256, MinInt256, deployer.address);
        expect(await pool.getPosition(1)).to.deep.eq([0n, 0n]);
        expect(await pool.getTotalRawCollaterals()).to.eq(InitialRawCollateral);
        expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("2000"));
      });
    });

    context("operate after redeem", async () => {
      beforeEach(async () => {
        // max redeem 20% per tick
        await pool.connect(admin).updateMaxRedeemRatioPerTick(ethers.parseUnits("0.2", 9));
        // remove open fee
        await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));

        // open 4 positions
        await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2200"), deployer.address);
        await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2100"), deployer.address);
        await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2000"), deployer.address);
        await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("1900"), deployer.address);

        // redeem 1640, max price 3001
        await pool.connect(signer).redeem(ethers.parseEther("1640"));
        expect((await pool.getPosition(1)).rawColls).to.closeTo(ethers.parseEther("0.966031379443284280"), 10n);
        expect((await pool.getPosition(1)).rawDebts).to.closeTo(ethers.parseEther("1408"), 1000000n);
        expect((await pool.getPosition(2)).rawColls).to.closeTo(ethers.parseEther("1.090046651116294569"), 10n);
        expect((await pool.getPosition(2)).rawDebts).to.closeTo(ethers.parseEther("1680"), 1000000n);
        expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("4.373515494835054982"), 10n);
        expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("6560"));
        expect(await pool.getTopTick()).to.eq(4898);
      });

      it("should succeed when operate position 1 and 2", async () => {
        // add collateral to position 2
        expect(
          await pool
            .connect(signer)
            .operate(2, ethers.parseEther("0.139953348883705431"), ethers.parseEther("420"), deployer.address)
        ).to.emit(pool, "PositionSnapshot");
        expect((await pool.getPosition(2)).rawColls).to.closeTo(ethers.parseEther("1.23"), 10n);
        expect((await pool.getPosition(2)).rawDebts).to.closeTo(ethers.parseEther("2100"), 1000000n);
        expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("4.513468843718760413"), 10n);
        expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("6980"));
        expect(await pool.getTopTick()).to.eq(4966);

        // add collateral to position 1
        expect(
          await pool
            .connect(signer)
            .operate(1, ethers.parseEther("0.263968620556715720"), ethers.parseEther("792"), deployer.address)
        ).to.emit(pool, "PositionSnapshot");
        expect((await pool.getPosition(1)).rawColls).to.closeTo(ethers.parseEther("1.23"), 10n);
        expect((await pool.getPosition(1)).rawDebts).to.closeTo(ethers.parseEther("2200"), 1000000n);
        expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("4.777437464275476133"), 10n);
        expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("7772"));
        expect(await pool.getTopTick()).to.eq(4997);
      });
    });
  });

  context("redeem", async () => {
    let signer: HardhatEthersSigner;

    beforeEach(async () => {
      await unlockAccounts([await poolManager.getAddress()]);
      signer = await ethers.getSigner(await poolManager.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));

      // max redeem 20% per tick
      await pool.connect(admin).updateMaxRedeemRatioPerTick(ethers.parseUnits("0.2", 9));
      // remove open fee
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));

      // open 4 positions
      await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2200"), deployer.address);
      await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2100"), deployer.address);
      await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2000"), deployer.address);
      await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("1900"), deployer.address);
      expect(await pool.getTopTick()).to.eq(4997);
    });

    it("should revert, when ErrorCallerNotPoolManager", async () => {
      await expect(pool.connect(deployer).redeem(0)).to.revertedWithCustomError(pool, "ErrorCallerNotPoolManager");
    });

    it("should revert, when redeem paused", async () => {
      await pool.connect(admin).grantRole(id("EMERGENCY_ROLE"), admin.address);
      await pool.connect(admin).updateBorrowAndRedeemStatus(true, true);
      await expect(pool.connect(signer).redeem(ethers.parseEther("440"))).to.revertedWithCustomError(
        pool,
        "ErrorRedeemPaused"
      );
    });

    it("should succeed, when redeem only in one position", async () => {
      // max price is 3001, redeem 440, get 0.146617794068643785
      expect(await pool.getPosition(1)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2200")]);
      expect(await pool.getPosition(2)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2100")]);
      expect(await pool.getTotalRawCollaterals()).to.eq(ethers.parseEther("1.23") * 4n);
      expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("8200"));
      await pool.connect(signer).redeem(ethers.parseEther("440"));
      expect(await pool.getPosition(2)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2100")]);
      expect((await pool.getPosition(1)).rawColls).to.closeTo(ethers.parseEther("1.083382205931356215"), 10n);
      expect((await pool.getPosition(1)).rawDebts).to.closeTo(ethers.parseEther("1760"), 1000000n);
      expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("4.773382205931356215"), 10n);
      expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("7760"));
    });

    it("should succeed, when redeem on two positions", async () => {
      const redeemAmount = ethers.parseEther("860");
      // max price is 3001, redeem 860, get 0.286571142952349216
      expect(await pool.getPosition(1)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2200")]);
      expect(await pool.getPosition(2)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2100")]);
      expect(await pool.getPosition(3)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2000")]);
      expect(await pool.getTotalRawCollaterals()).to.eq(ethers.parseEther("1.23") * 4n);
      expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("8200"));
      expect(await pool.connect(signer).redeem.staticCall(redeemAmount)).to.closeTo(
        ethers.parseEther("0.286571142952349216"),
        10n
      );
      await pool.connect(signer).redeem(redeemAmount);
      expect(await pool.getPosition(3)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2000")]);
      expect((await pool.getPosition(2)).rawColls).to.closeTo(ethers.parseEther("1.090046651116294569"), 10n);
      expect((await pool.getPosition(2)).rawDebts).to.closeTo(ethers.parseEther("1680"), 1000000n);
      expect((await pool.getPosition(1)).rawColls).to.closeTo(ethers.parseEther("1.083382205931356215"), 10n);
      expect((await pool.getPosition(1)).rawDebts).to.closeTo(ethers.parseEther("1760"), 1000000n);
      expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("4.633428857047650784"), 10n);
      expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("7340"));
    });

    it("should succeed, when redeem on four positions", async () => {
      const redeemAmount = ethers.parseEther("1640");
      // max price is 3001, redeem 1640, get 0.546484505164945018
      // position 1 at tick 4997, jump to tick 4933, redeem 440, get 0.146617794068643785
      // position 2 at tick 4966, jump to tick 4898, redeem 420, get 0.139953348883705431
      // position 3 at tick 4933, jump to tick 4861, redeem 752, get 0.250583138953682105
      // position 4 at tick 4899, jump to tick 4894, redeem 28, get 0.009330223258913695
      // position 1 redeemed twice, first in tick 4997, than in tick 4933
      expect(await pool.getPosition(1)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2200")]);
      expect(await pool.getPosition(2)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2100")]);
      expect(await pool.getPosition(3)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2000")]);
      expect(await pool.getPosition(4)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("1900")]);
      expect(await pool.getTotalRawCollaterals()).to.eq(ethers.parseEther("1.23") * 4n);
      expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("8200"));
      expect(await pool.connect(signer).redeem.staticCall(redeemAmount)).to.closeTo(
        ethers.parseEther("0.546484505164945018"),
        10n
      );
      await pool.connect(signer).redeem(redeemAmount);
      expect((await pool.getPosition(4)).rawColls).to.closeTo(ethers.parseEther("1.220669776741086305"), 10n);
      expect((await pool.getPosition(4)).rawDebts).to.closeTo(ethers.parseEther("1872"), 1000000n);
      expect((await pool.getPosition(3)).rawColls).to.closeTo(ethers.parseEther("1.096767687534389826"), 10n);
      expect((await pool.getPosition(3)).rawDebts).to.closeTo(ethers.parseEther("1600"), 1000000n);
      expect((await pool.getPosition(2)).rawColls).to.closeTo(ethers.parseEther("1.090046651116294569"), 10n);
      expect((await pool.getPosition(2)).rawDebts).to.closeTo(ethers.parseEther("1680"), 1000000n);
      expect((await pool.getPosition(1)).rawColls).to.closeTo(ethers.parseEther("0.966031379443284280"), 10n);
      expect((await pool.getPosition(1)).rawDebts).to.closeTo(ethers.parseEther("1408"), 1000000n);
      expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("4.373515494835054982"), 10n);
      expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("6560"));
      expect(await pool.getTopTick()).to.eq(4898);
    });

    it("should succeed, when redeem almost all", async () => {
      await pool.connect(signer).redeem(ethers.parseEther("8100"));
      expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("2.220899700099966678"), 1000000n);
      expect(await pool.getTotalRawDebts()).to.closeTo(ethers.parseEther("100"), 1000000n);
    });
  });

  context("rebalance on tick", async () => {
    let signer: HardhatEthersSigner;

    beforeEach(async () => {
      await unlockAccounts([await poolManager.getAddress()]);
      signer = await ethers.getSigner(await poolManager.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));
      // remove open fee
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));

      // open 3 positions on the same tick
      await pool.connect(signer).operate(0, ethers.parseEther("0.123"), ethers.parseEther("220"), deployer.address);
      await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2200"), deployer.address);
      await pool.connect(signer).operate(0, ethers.parseEther("12.3"), ethers.parseEther("22000"), deployer.address);
      expect(await pool.getNextTreeNodeId()).to.eq(2);
      expect(await pool.getTopTick()).to.eq(4997);
    });

    it("should revert, when ErrorCallerNotPoolManager", async () => {
      await expect(pool.connect(deployer)["rebalance(int16,uint256)"](0, 0)).to.revertedWithCustomError(
        pool,
        "ErrorCallerNotPoolManager"
      );
    });

    it("should revert, when ErrorRebalanceDebtRatioNotReached", async () => {
      await expect(pool.connect(signer)["rebalance(int16,uint256)"](4997, MaxUint256)).to.revertedWithCustomError(
        pool,
        "ErrorRebalanceDebtRatioNotReached"
      );
    });

    it("should revert, when ErrorRebalanceOnLiquidatableTick", async () => {
      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 1000,
      await mockPriceOracle.setPrices(ethers.parseEther("1000"), ethers.parseEther("1000"), ethers.parseEther("1000"));

      await expect(pool.connect(signer)["rebalance(int16,uint256)"](4997, MaxUint256)).to.revertedWithCustomError(
        pool,
        "ErrorRebalanceOnLiquidatableTick"
      );
    });

    it("should ok", async () => {
      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));

      // rebalance to 0.88
      const [rawColls, rawDebts, bonusRawColls] = await pool
        .connect(signer)
        ["rebalance(int16,uint256)"].staticCall(4997, MaxUint256);
      expect(rawColls).to.eq(1993469387755102040n);
      expect(rawDebts).to.eq(3986938775510204081632n);
      expect(bonusRawColls).to.eq((rawColls * 25n) / 1000n);
      await pool.connect(signer)["rebalance(int16,uint256)"](4997, MaxUint256);
      expect(await pool.getTopTick()).to.eq(4986);
      expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("11.609693877551020409"), 10n);
      expect(await pool.getTotalRawDebts()).to.closeTo(ethers.parseEther("20433.061224489795918368"), 10n);
      expect(
        ((await pool.getTotalRawDebts()) * 10n ** 18n) / ((await pool.getTotalRawCollaterals()) * 2000n)
      ).to.closeTo(ethers.parseEther("0.88"), 1000000n);
      expect(
        ((await pool.getPosition(1)).rawDebts * 10n ** 18n) / ((await pool.getPosition(1)).rawColls * 2000n)
      ).to.closeTo(ethers.parseEther("0.88"), 1000000n);
      expect(
        ((await pool.getPosition(2)).rawDebts * 10n ** 18n) / ((await pool.getPosition(2)).rawColls * 2000n)
      ).to.closeTo(ethers.parseEther("0.88"), 1000000n);
      expect(
        ((await pool.getPosition(3)).rawDebts * 10n ** 18n) / ((await pool.getPosition(3)).rawColls * 2000n)
      ).to.closeTo(ethers.parseEther("0.88"), 1000000n);
      expect((await pool.getPosition(1)).rawColls).to.closeTo(ethers.parseEther("0.104591836734693877"), 10n);
      expect((await pool.getPosition(1)).rawDebts).to.closeTo(ethers.parseEther("184.081632653061224305"), 1000000n);
      expect((await pool.getPosition(2)).rawColls).to.closeTo(ethers.parseEther("1.045918367346938774"), 10n);
      expect((await pool.getPosition(2)).rawDebts).to.closeTo(ethers.parseEther("1840.816326530612243057"), 1000000n);
      expect((await pool.getPosition(3)).rawColls).to.closeTo(ethers.parseEther("10.459183673469387745"), 10n);
      expect((await pool.getPosition(3)).rawDebts).to.closeTo(ethers.parseEther("18408.163265306122430572"), 1000000n);
    });
  });

  context("batch rebalance", async () => {
    let signer: HardhatEthersSigner;

    beforeEach(async () => {
      await unlockAccounts([await poolManager.getAddress()]);
      signer = await ethers.getSigner(await poolManager.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));
      // remove open fee
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));

      // open 3 positions on the same tick
      await pool.connect(signer).operate(0, ethers.parseEther("0.123"), ethers.parseEther("220"), deployer.address);
      await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2200"), deployer.address);
      await pool.connect(signer).operate(0, ethers.parseEther("12.3"), ethers.parseEther("22000"), deployer.address);
      expect(await pool.getNextTreeNodeId()).to.eq(2);
      expect(await pool.getTopTick()).to.eq(4997);
    });

    it("should revert, when ErrorCallerNotPoolManager", async () => {
      await expect(pool.connect(deployer)["rebalance(uint256)"](0)).to.revertedWithCustomError(
        pool,
        "ErrorCallerNotPoolManager"
      );
    });

    it("should ok", async () => {
      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 2000, debt ratio became 0.894308943089430894
      await mockPriceOracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));

      // rebalance to 0.88
      const [rawColls, rawDebts, bonusRawColls] = await pool
        .connect(signer)
        ["rebalance(uint256)"].staticCall(MaxUint256);
      expect(rawColls).to.eq(1993469387755102040n);
      expect(rawDebts).to.eq(3986938775510204081632n);
      expect(bonusRawColls).to.eq((rawColls * 25n) / 1000n);
      await pool.connect(signer)["rebalance(uint256)"](MaxUint256);
      expect(await pool.getTopTick()).to.eq(4986);
      expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("11.609693877551020409"), 10n);
      expect(await pool.getTotalRawDebts()).to.closeTo(ethers.parseEther("20433.061224489795918368"), 10n);
      expect(
        ((await pool.getTotalRawDebts()) * 10n ** 18n) / ((await pool.getTotalRawCollaterals()) * 2000n)
      ).to.closeTo(ethers.parseEther("0.88"), 1000000n);
      expect(
        ((await pool.getPosition(1)).rawDebts * 10n ** 18n) / ((await pool.getPosition(1)).rawColls * 2000n)
      ).to.closeTo(ethers.parseEther("0.88"), 1000000n);
      expect(
        ((await pool.getPosition(2)).rawDebts * 10n ** 18n) / ((await pool.getPosition(2)).rawColls * 2000n)
      ).to.closeTo(ethers.parseEther("0.88"), 1000000n);
      expect(
        ((await pool.getPosition(3)).rawDebts * 10n ** 18n) / ((await pool.getPosition(3)).rawColls * 2000n)
      ).to.closeTo(ethers.parseEther("0.88"), 1000000n);
      expect((await pool.getPosition(1)).rawColls).to.closeTo(ethers.parseEther("0.104591836734693877"), 10n);
      expect((await pool.getPosition(1)).rawDebts).to.closeTo(ethers.parseEther("184.081632653061224305"), 1000000n);
      expect((await pool.getPosition(2)).rawColls).to.closeTo(ethers.parseEther("1.045918367346938774"), 10n);
      expect((await pool.getPosition(2)).rawDebts).to.closeTo(ethers.parseEther("1840.816326530612243057"), 1000000n);
      expect((await pool.getPosition(3)).rawColls).to.closeTo(ethers.parseEther("10.459183673469387745"), 10n);
      expect((await pool.getPosition(3)).rawDebts).to.closeTo(ethers.parseEther("18408.163265306122430572"), 1000000n);
    });
  });

  context("batch liquidate", async () => {
    let signer: HardhatEthersSigner;

    beforeEach(async () => {
      await unlockAccounts([await poolManager.getAddress()]);
      signer = await ethers.getSigner(await poolManager.getAddress());
      await mockETHBalance(signer.address, ethers.parseEther("100"));
      // remove open fee
      await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
      await pool.connect(admin).updateDebtRatioRange(0, ethers.parseEther("1"));

      // open 3 positions on the same tick
      await pool.connect(signer).operate(0, ethers.parseEther("0.123"), ethers.parseEther("220"), deployer.address);
      await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("1000"), deployer.address);
      await pool.connect(signer).operate(0, ethers.parseEther("12.3"), ethers.parseEther("10000"), deployer.address);
      expect(await pool.getNextTreeNodeId()).to.eq(3);
      expect(await pool.getTopTick()).to.eq(4997);
    });

    it("should revert, when ErrorCallerNotPoolManager", async () => {
      await expect(pool.connect(deployer).liquidate(0, 0)).to.revertedWithCustomError(
        pool,
        "ErrorCallerNotPoolManager"
      );
    });

    it("should ok, when collateral can cover bonus", async () => {
      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 1900, debt ratio became 0.941377834830979888
      await mockPriceOracle.setPrices(ethers.parseEther("1900"), ethers.parseEther("1900"), ethers.parseEther("1900"));

      // liquidate position 1
      let [rawColls, rawDebts, bonusRawColls, bonusFromReserve] = await pool
        .connect(signer)
        .liquidate.staticCall(MaxUint256, MaxUint256 / 2n);
      expect(rawColls).to.closeTo(ethers.parseEther("0.115789473684210526"), 1000000n);
      expect(rawDebts).to.eq(ethers.parseEther("220"));
      expect(bonusRawColls).to.closeTo((rawColls * 5n) / 100n, 1000000n);
      expect(bonusFromReserve).to.eq(0n);
      await pool.connect(signer).liquidate(MaxUint256, MaxUint256 / 2n);
      expect((await pool.getPosition(1)).rawColls).to.closeTo(ethers.parseEther("0.001421052631578948"), 1000000n);
      expect((await pool.getPosition(1)).rawDebts).to.eq(0n);
    });

    it("should ok, when collateral + reserve can cover bonus", async () => {
      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 1850, debt ratio became 0.966820479015600966
      await mockPriceOracle.setPrices(ethers.parseEther("1850"), ethers.parseEther("1850"), ethers.parseEther("1850"));

      // liquidate position 1
      let [rawColls, rawDebts, bonusRawColls, bonusFromReserve] = await pool
        .connect(signer)
        .liquidate.staticCall(MaxUint256, MaxUint256 / 2n);
      expect(rawColls).to.closeTo(ethers.parseEther("0.118918918918918918"), 1000000n);
      expect(rawDebts).to.eq(ethers.parseEther("220"));
      expect(bonusRawColls).to.closeTo((rawColls * 5n) / 100n, 1000000n);
      expect(bonusFromReserve).to.closeTo(ethers.parseEther("0.001864864864864863"), 1000000n);
      await pool.connect(signer).liquidate(MaxUint256, MaxUint256 / 2n);
      expect((await pool.getPosition(1)).rawColls).to.eq(0n);
      expect((await pool.getPosition(1)).rawDebts).to.eq(0n);

      expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("13.53"), 1000000n);
      expect(await pool.getTotalRawDebts()).to.closeTo(ethers.parseEther("11000"), 1000000n);
    });

    it("should ok, when collateral + reserve cannot cover bonus", async () => {
      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 1850, debt ratio became 0.966820479015600966
      await mockPriceOracle.setPrices(ethers.parseEther("1850"), ethers.parseEther("1850"), ethers.parseEther("1850"));

      // liquidate position 1
      let [rawColls, rawDebts, bonusRawColls, bonusFromReserve] = await pool
        .connect(signer)
        .liquidate.staticCall(MaxUint256, ethers.parseEther("0.001"));
      expect(rawColls).to.closeTo(ethers.parseEther("0.118918918918918918"), 1000000n);
      expect(rawDebts).to.eq(ethers.parseEther("220"));
      expect(bonusRawColls).to.closeTo(ethers.parseEther(".005081081081081082"), 1000000n);
      expect(bonusFromReserve).to.closeTo(ethers.parseEther("0.001"), 1000000n);
      await pool.connect(signer).liquidate(MaxUint256, ethers.parseEther("0.001"));
      expect((await pool.getPosition(1)).rawColls).to.eq(0n);
      expect((await pool.getPosition(1)).rawDebts).to.eq(0n);

      expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("13.53"), 1000000n);
      expect(await pool.getTotalRawDebts()).to.closeTo(ethers.parseEther("11000"), 1000000n);
    });

    it("should ok, when distribute bad debts", async () => {
      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 1700, debt ratio became 1.052128168340506934
      await mockPriceOracle.setPrices(ethers.parseEther("1700"), ethers.parseEther("1700"), ethers.parseEther("1700"));

      // liquidate position 1, and bad debt distribute to position 2 and 3
      let [rawColls, rawDebts, bonusRawColls, bonusFromReserve] = await pool
        .connect(signer)
        .liquidate.staticCall(ethers.parseEther("209"), 0n);
      expect(rawColls).to.closeTo(ethers.parseEther("0.122941176470588235"), 1000000n);
      expect(rawDebts).to.eq(ethers.parseEther("209"));
      expect(bonusRawColls).to.closeTo(ethers.parseEther("0.000058823529411765"), 1000000n);
      expect(bonusFromReserve).to.eq(0n);
      expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
      await pool.connect(signer).liquidate(ethers.parseEther("209"), 0n);
      expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([79307390676778601931137494286n, 2n ** 96n]);
      expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("13.53"), 1000000n);
      expect(await pool.getTotalRawDebts()).to.closeTo(ethers.parseEther("11010.999999999999999999"), 1000000n);
      expect((await pool.getPosition(1)).rawColls).to.eq(0n);
      expect((await pool.getPosition(1)).rawDebts).to.eq(0n);
      expect((await pool.getPosition(2)).rawColls).to.eq(ethers.parseEther("1.23"));
      expect((await pool.getPosition(2)).rawDebts).to.closeTo(ethers.parseEther("1000.999999999999999999"), 1000000n);
      expect((await pool.getPosition(3)).rawColls).to.eq(ethers.parseEther("12.3"));
      expect((await pool.getPosition(3)).rawDebts).to.closeTo(ethers.parseEther("10009.999999999999999999"), 1000000n);
    });

    it("should ok, when distribute bad debts with maximum input", async () => {
      // current debt ratio is 0.596404763647503097 for min price = 2999
      // min price drop to 1700, debt ratio became 1.052128168340506934
      await mockPriceOracle.setPrices(ethers.parseEther("1700"), ethers.parseEther("1700"), ethers.parseEther("1700"));

      // liquidate position 1, and bad debt distribute to position 2 and 3
      let [rawColls, rawDebts, bonusRawColls, bonusFromReserve] = await pool
        .connect(signer)
        .liquidate.staticCall(MaxUint256, 0n);
      expect(rawColls).to.closeTo(ethers.parseEther("0.123"), 1000000n);
      expect(rawDebts).to.eq(ethers.parseEther("209.1"));
      expect(bonusRawColls).to.eq(0n);
      expect(bonusFromReserve).to.eq(0n);
      expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
      await pool.connect(signer).liquidate(MaxUint256, 0n);
      expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([79306670420755744982613916614n, 2n ** 96n]);
      expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("13.53"), 1000000n);
      expect(await pool.getTotalRawDebts()).to.closeTo(ethers.parseEther("11010.899999999999999999"), 1000000n);
      expect((await pool.getPosition(1)).rawColls).to.eq(0n);
      expect((await pool.getPosition(1)).rawDebts).to.eq(0n);
      expect((await pool.getPosition(2)).rawColls).to.eq(ethers.parseEther("1.23"));
      expect((await pool.getPosition(2)).rawDebts).to.closeTo(ethers.parseEther("1000.990909090909090909"), 1000000n);
      expect((await pool.getPosition(3)).rawColls).to.eq(ethers.parseEther("12.3"));
      expect((await pool.getPosition(3)).rawDebts).to.closeTo(ethers.parseEther("10009.909090909090909090"), 1000000n);
    });
  });
});
