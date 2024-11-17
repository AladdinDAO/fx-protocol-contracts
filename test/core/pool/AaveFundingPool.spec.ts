/* eslint-disable camelcase */
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers } from "hardhat";

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
    await pool.updateRebalanceRatios(ethers.parseEther("0.85"), ethers.parseUnits("0.025", 9));
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
      expect(await pool.getRebalanceRatios()).to.deep.eq([ethers.parseEther("0.85"), ethers.parseUnits("0.025", 9)]);
      expect(await pool.getLiquidateRatios()).to.deep.eq([ethers.parseEther("0.92"), ethers.parseUnits("0.05", 9)]);
      expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
      expect(await pool.getDebtAndCollateralShares()).to.deep.eq([0n, 0n]);
      expect(await pool.getTotalRawColls()).to.eq(0n);
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

  context("auth", async () => {});

  context("#operate", async () => {
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

      await expect(
        pool.connect(signer).operate(1, newRawColl - protocolFees, ethers.parseEther("2000"), signer.address)
      ).to.revertedWithCustomError(pool, "ErrorNotPositionOwner");
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
    });
  });
});
