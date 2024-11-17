/* eslint-disable camelcase */
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { MinInt256, ZeroAddress, ZeroHash } from "ethers";
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
  SfxUSDRewarder,
  StakedFxUSD,
  StakedFxUSD__factory,
} from "@/types/index";
import { encodeChainlinkPriceFeed } from "@/utils/index";
import { mockETHBalance, unlockAccounts } from "@/test/utils";

describe("AaveFundingPool.spec", async () => {
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
  let sfxUSD: StakedFxUSD;
  let sfxUSDRewarder: SfxUSDRewarder;

  let mockAggregatorV3Interface: MockAggregatorV3Interface;
  let mockCurveStableSwapNG: MockCurveStableSwapNG;
  let mockPriceOracle: MockPriceOracle;
  let mockAaveV3Pool: MockAaveV3Pool;

  let pool: AaveFundingPool;

  beforeEach(async () => {
    [deployer, admin, platform] = await ethers.getSigners();

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

    const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
    const EmptyContract = await ethers.getContractFactory("EmptyContract", deployer);
    const TransparentUpgradeableProxy = await ethers.getContractFactory("TransparentUpgradeableProxy", deployer);
    const ProxyAdmin = await ethers.getContractFactory("ProxyAdmin", deployer);
    const FxUSDRegeneracy = await ethers.getContractFactory("FxUSDRegeneracy", deployer);
    const PegKeeper = await ethers.getContractFactory("PegKeeper", deployer);
    const PoolManager = await ethers.getContractFactory("PoolManager", deployer);
    const StakedFxUSD = await ethers.getContractFactory("StakedFxUSD", deployer);
    const ReservePool = await ethers.getContractFactory("ReservePool", deployer);
    const SfxUSDRewarder = await ethers.getContractFactory("SfxUSDRewarder", deployer);
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
    const StakedFxUSDProxy = await TransparentUpgradeableProxy.deploy(
      empty.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );

    // deploy ReservePool
    reservePool = await ReservePool.deploy(admin.address, PoolManagerProxy.getAddress());

    // deploy PoolManager
    const PoolManagerImpl = await PoolManager.deploy(
      FxUSDRegeneracyProxy.getAddress(),
      StakedFxUSDProxy.getAddress(),
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

    // deploy StakedFxUSD
    const StakedFxUSDImpl = await StakedFxUSD.deploy(
      PoolManagerProxy.getAddress(),
      PegKeeperProxy.getAddress(),
      FxUSDRegeneracyProxy.getAddress(),
      stableToken.getAddress(),
      encodeChainlinkPriceFeed(await mockAggregatorV3Interface.getAddress(), 10n ** 10n, 1000000000)
    );
    await proxyAdmin.upgradeAndCall(
      StakedFxUSDProxy.getAddress(),
      StakedFxUSDImpl.getAddress(),
      StakedFxUSD__factory.createInterface().encodeFunctionData("initialize", [
        admin.address,
        "Staked f(x) USD",
        "sfxUSD",
        ethers.parseEther("0.995"),
      ])
    );
    sfxUSD = await ethers.getContractAt("StakedFxUSD", await StakedFxUSDProxy.getAddress(), admin);

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

    sfxUSDRewarder = await SfxUSDRewarder.deploy(sfxUSD.getAddress());
    await sfxUSD.grantRole(await sfxUSD.REWARD_DEPOSITOR_ROLE(), sfxUSDRewarder.getAddress());
    await poolManager.registerPool(
      pool.getAddress(),
      sfxUSDRewarder.getAddress(),
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
      it("should revert, when caller is not admin", async () => {
        await expect(pool.connect(deployer).updateBorrowAndRedeemStatus(false, false))
          .to.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed", async () => {
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
        await mockAaveV3Pool.setVariableBorrowRate(ethers.parseUnits("0.01", 27));
        await pool.connect(signer).operate(0, ethers.parseEther("1"), ethers.parseEther("2000"), deployer.address);
        expect(await pool.getOpenFeeRatio()).to.eq(ethers.parseUnits("0.001", 9));
        await mockAaveV3Pool.setVariableBorrowRate(ethers.parseUnits("0.06", 27));
        await pool.connect(signer).operate(0, ethers.parseEther("1"), ethers.parseEther("2000"), deployer.address);
        expect(await pool.getOpenFeeRatio()).to.eq(ethers.parseUnits("0.001", 9));
        await mockAaveV3Pool.setVariableBorrowRate(ethers.parseUnits("0.1", 27));
        await pool.connect(signer).operate(0, ethers.parseEther("1"), ethers.parseEther("2000"), deployer.address);
        expect(await pool.getOpenFeeRatio()).to.eq(ethers.parseUnits("0.001", 9));
        await mockAaveV3Pool.setVariableBorrowRate(ethers.parseUnits("0.11", 27));
        await pool.connect(signer).operate(0, ethers.parseEther("1"), ethers.parseEther("2000"), deployer.address);
        expect(await pool.getOpenFeeRatio()).to.eq(ethers.parseUnits("0.001", 9) * 2n);
        await mockAaveV3Pool.setVariableBorrowRate(ethers.parseUnits("0.16", 27));
        await pool.connect(signer).operate(0, ethers.parseEther("1"), ethers.parseEther("2000"), deployer.address);
        expect(await pool.getOpenFeeRatio()).to.eq(ethers.parseUnits("0.001", 9) * 3n);
        await pool.updateOpenRatio(ethers.parseUnits("0.000001", 9), ethers.parseEther("0.05"));
        await mockAaveV3Pool.setVariableBorrowRate(295147905179352825855000000000n);
        await pool.connect(signer).operate(0, ethers.parseEther("1"), ethers.parseEther("2000"), deployer.address);
        expect(await pool.getOpenFeeRatio()).to.eq(ethers.parseUnits("0.000001", 9) * 5902n);
        await mockAaveV3Pool.setVariableBorrowRate(395147905179352825855000000000n);
        await pool.connect(signer).operate(0, ethers.parseEther("1"), ethers.parseEther("2000"), deployer.address);
        expect(await pool.getOpenFeeRatio()).to.eq(ethers.parseUnits("0.000001", 9) * 5902n);
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
          .operate(0, ethers.parseEther("1.23"), ethers.parseEther("3161.802857142857139695"), deployer.address)
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
        .withArgs(1, newRawColl - protocolFees, ethers.parseEther("2000") + 1n, ethers.parseEther("2999"));
      expect(await pool.ownerOf(1)).to.eq(deployer.address);
      expect(await pool.getPosition(1)).to.deep.eq([newRawColl - protocolFees, ethers.parseEther("2000") + 1n]);
      expect(await pool.getNextPositionId()).to.eq(2);
      expect(await pool.getNextTreeNodeId()).to.eq(2);
      expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
      expect(await pool.getDebtAndCollateralShares()).to.deep.eq([
        ethers.parseEther("2000") + 1n,
        newRawColl - protocolFees,
      ]);
      expect(await pool.getTopTick()).to.eq((await pool.positionData(1)).tick);

      await expect(
        pool.connect(signer).operate(1, newRawColl - protocolFees, ethers.parseEther("2000"), signer.address)
      ).to.revertedWithCustomError(pool, "ErrorNotPositionOwner");
    });

    it("should succeed, operate on multiple new positions", async () => {});

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

      it("should charge funding fee, when enabled and funding ratio is zero", async () => {
        const [, startTime] = await pool.getInterestRateSnapshot();
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
        const [rate, startTime] = await pool.getInterestRateSnapshot();
        await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("0.8"));
        expect(await pegKeeper.isFundingEnabled()).to.eq(true);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
        await network.provider.send("evm_setNextBlockTimestamp", [Number(startTime) + 86400 * 7]);
        await pool.connect(signer).operate(1, ethers.parseEther("0.01"), 0n, deployer.address);
        const timestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
        const funding =
          (InitialRawCollateral * rate * (BigInt(timestamp) - startTime)) / (86400n * 365n * 10n ** 18n) / 10n;
        // 1.22877 * 0.05 * 7 / 365 * 0.1 = 0.000117827260273972
        expect(funding).to.eq(ethers.parseEther(".000117827260273972"));
        // 1.23 - 1.23 / 1000 + 0.01 - 0.01 / 1000 - 0.000117827260273972 = 1.238642172739726028
        expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("1.238642172739726028"), 10);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 79235760463897862007198239823n]);
      });
    });

    context("operate on old position", async () => {
      const InitialRawCollateral = ethers.parseEther("1.23") - ethers.parseEther("1.23") / 1000n;
      const InitialRawDebt = ethers.parseEther("2000") + 1n;

      beforeEach(async () => {
        expect(
          await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2000"), deployer.address)
        ).to.to.emit(pool, "PositionSnapshot");
      });

      it("should succeed to add collateral", async () => {
        const rawColl = ethers.parseEther("0.01");
        expect(await pool.connect(signer).operate(1, rawColl, 0n, deployer.address)).to.to.emit(
          pool,
          "PositionSnapshot"
        );
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
        expect(await pool.getPosition(1)).to.deep.eq([InitialRawCollateral - rawColl + 1n, InitialRawDebt]);
        expect(await pool.getNextPositionId()).to.eq(2);
        expect(await pool.getNextTreeNodeId()).to.eq(3);
        expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
        expect(await pool.getDebtAndCollateralShares()).to.deep.eq([
          InitialRawDebt,
          InitialRawCollateral - rawColl + 1n,
        ]);
      });

      it("should succeed to borrow debt", async () => {
        await pool.connect(signer).operate(1, 0n, ethers.parseEther("0.1"), deployer.address);
      });

      it("should succeed to repay debt", async () => {
        await pool.connect(signer).operate(1, 0n, -ethers.parseEther("0.1"), deployer.address);
      });

      it("should succeed close entire position", async () => {
        // open another one to avoid ErrorPoolUnderCollateral
        await pool.connect(signer).operate(0, ethers.parseEther("1.23"), ethers.parseEther("2000"), deployer.address);
        await pool.connect(signer).operate(1, MinInt256, MinInt256, deployer.address);
        expect(await pool.getPosition(1)).to.deep.eq([0n, 0n]);
      });
    });

    context("operate after redeem", async () => {});

    context("operate after rebalance", async () => {});
  });

  context("redeem", async () => {});

  context("rebalance on tick", async () => {});

  context("rebalance on position", async () => {});

  context("liquidate on position", async () => {});
});
