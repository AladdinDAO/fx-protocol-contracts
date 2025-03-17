/* eslint-disable camelcase */
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { id, MaxUint256, MinInt256, ZeroAddress, ZeroHash } from "ethers";
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
  MockFxUSDSave,
  PegKeeper,
  PegKeeper__factory,
  PoolManager,
  PoolManager__factory,
  ProxyAdmin,
  ReservePool,
  GaugeRewarder,
} from "@/types/index";
import { encodeChainlinkPriceFeed } from "@/utils/index";

const TokenRate = ethers.parseEther("1.23");

describe("PoolManager.spec", async () => {
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
  let fxBASE: MockFxUSDSave;
  let rewarder: GaugeRewarder;

  let mockAggregatorV3Interface: MockAggregatorV3Interface;
  let mockCurveStableSwapNG: MockCurveStableSwapNG;
  let mockPriceOracle: MockPriceOracle;
  let mockRateProvider: MockRateProvider;
  let mockAaveV3Pool: MockAaveV3Pool;

  let pool: AaveFundingPool;

  const runTests = async (tokenDecimals: bigint) => {
    const TokenScale = 10n ** (18n - tokenDecimals);

    context(`decimals=${tokenDecimals}`, async () => {
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
        const MockFxUSDSave = await ethers.getContractFactory("MockFxUSDSave", deployer);
        const ReservePool = await ethers.getContractFactory("ReservePool", deployer);
        const GaugeRewarder = await ethers.getContractFactory("GaugeRewarder", deployer);
        const MultiPathConverter = await ethers.getContractFactory("MultiPathConverter", deployer);

        const empty = await EmptyContract.deploy();
        stableToken = await MockERC20.deploy("USDC", "USDC", 6);
        collateralToken = await MockERC20.deploy("X", "Y", tokenDecimals);
        proxyAdmin = await ProxyAdmin.connect(admin).deploy();
        const converter = await MultiPathConverter.deploy(ZeroAddress);

        const FxUSDRegeneracyProxy = await TransparentUpgradeableProxy.deploy(
          empty.getAddress(),
          proxyAdmin.getAddress(),
          "0x"
        );
        const PegKeeperProxy = await TransparentUpgradeableProxy.deploy(
          empty.getAddress(),
          proxyAdmin.getAddress(),
          "0x"
        );
        const PoolManagerProxy = await TransparentUpgradeableProxy.deploy(
          empty.getAddress(),
          proxyAdmin.getAddress(),
          "0x"
        );
        const FxUSDSaveProxy = await TransparentUpgradeableProxy.deploy(
          empty.getAddress(),
          proxyAdmin.getAddress(),
          "0x"
        );

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

        // deploy FxUSDSave
        const FxUSDSaveImpl = await MockFxUSDSave.deploy(
          PoolManagerProxy.getAddress(),
          PegKeeperProxy.getAddress(),
          FxUSDRegeneracyProxy.getAddress(),
          stableToken.getAddress(),
          encodeChainlinkPriceFeed(await mockAggregatorV3Interface.getAddress(), 10n ** 10n, 1000000000)
        );
        await proxyAdmin.upgrade(FxUSDSaveProxy.getAddress(), FxUSDSaveImpl.getAddress());
        fxBASE = await ethers.getContractAt("MockFxUSDSave", await FxUSDSaveProxy.getAddress(), admin);

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

        rewarder = await GaugeRewarder.deploy(fxBASE.getAddress());
        await poolManager.registerPool(
          pool.getAddress(),
          rewarder.getAddress(),
          ethers.parseUnits("10000", tokenDecimals),
          ethers.parseEther("10000000")
        );
        await poolManager.updateRateProvider(collateralToken.getAddress(), mockRateProvider.getAddress());
        await mockCurveStableSwapNG.setCoin(0, stableToken.getAddress());
        await mockCurveStableSwapNG.setCoin(1, fxUSD.getAddress());
        await mockCurveStableSwapNG.setPriceOracle(0, ethers.parseEther("1"));
      });

      context("constructor", async () => {
        it("should initialize correctly", async () => {
          expect(await poolManager.fxUSD()).to.eq(await fxUSD.getAddress());
          expect(await poolManager.fxBASE()).to.eq(await fxBASE.getAddress());
          expect(await poolManager.pegKeeper()).to.eq(await pegKeeper.getAddress());

          expect(await poolManager.treasury()).to.eq(treasury.address);
          expect(await poolManager.openRevenuePool()).to.eq(revenuePool.address);
          expect(await poolManager.closeRevenuePool()).to.eq(revenuePool.address);
          expect(await poolManager.miscRevenuePool()).to.eq(revenuePool.address);
          expect(await poolManager.reservePool()).to.eq(await reservePool.getAddress());
          expect(await poolManager.getFundingExpenseRatio()).to.eq(ethers.parseUnits("0.1", 9));
          expect(await poolManager.getRewardsExpenseRatio()).to.eq(ethers.parseUnits("0.1", 9));
          expect(await poolManager.getHarvesterRatio()).to.eq(ethers.parseUnits("0.01", 9));
          expect(await poolManager.getFundingFxSaveRatio()).to.eq(ethers.parseUnits("0.89", 9));
          expect(await poolManager.getRewardsFxSaveRatio()).to.eq(ethers.parseUnits("0.89", 9));
          expect(await poolManager.getFlashLoanFeeRatio()).to.eq(ethers.parseUnits("0.0001", 9));
          expect(await poolManager.getRedeemFeeRatio()).to.eq(0n);
        });

        it("should revert, when initialize again", async () => {
          await expect(
            poolManager.initialize(ZeroAddress, 0n, 0n, 0n, ZeroAddress, ZeroAddress, ZeroAddress)
          ).to.revertedWithCustomError(poolManager, "InvalidInitialization");
        });
      });

      context("auth", async () => {
        context("#updateReservePool", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateReservePool(ZeroAddress))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorZeroAddress", async () => {
            await expect(poolManager.connect(admin).updateReservePool(ZeroAddress)).to.revertedWithCustomError(
              pool,
              "ErrorZeroAddress"
            );
          });

          it("should succeed", async () => {
            expect(await poolManager.reservePool()).to.eq(await reservePool.getAddress());
            await expect(poolManager.connect(admin).updateReservePool(deployer.address))
              .to.emit(poolManager, "UpdateReservePool")
              .withArgs(await reservePool.getAddress(), deployer.address);
            expect(await poolManager.reservePool()).to.eq(deployer.address);
          });
        });

        context("#updateTreasury", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateTreasury(ZeroAddress))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorZeroAddress", async () => {
            await expect(poolManager.connect(admin).updateTreasury(ZeroAddress)).to.revertedWithCustomError(
              pool,
              "ErrorZeroAddress"
            );
          });

          it("should succeed", async () => {
            expect(await poolManager.treasury()).to.eq(await treasury.getAddress());
            await expect(poolManager.connect(admin).updateTreasury(deployer.address))
              .to.emit(poolManager, "UpdateTreasury")
              .withArgs(await treasury.getAddress(), deployer.address);
            expect(await poolManager.treasury()).to.eq(deployer.address);
          });
        });

        context("#updateOpenRevenuePool", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateOpenRevenuePool(ZeroAddress))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorZeroAddress", async () => {
            await expect(poolManager.connect(admin).updateOpenRevenuePool(ZeroAddress)).to.revertedWithCustomError(
              pool,
              "ErrorZeroAddress"
            );
          });

          it("should succeed", async () => {
            expect(await poolManager.openRevenuePool()).to.eq(await revenuePool.getAddress());
            await expect(poolManager.connect(admin).updateOpenRevenuePool(deployer.address))
              .to.emit(poolManager, "UpdateOpenRevenuePool")
              .withArgs(await revenuePool.getAddress(), deployer.address);
            expect(await poolManager.openRevenuePool()).to.eq(deployer.address);
          });
        });

        context("#updateCloseRevenuePool", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateCloseRevenuePool(ZeroAddress))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorZeroAddress", async () => {
            await expect(poolManager.connect(admin).updateCloseRevenuePool(ZeroAddress)).to.revertedWithCustomError(
              pool,
              "ErrorZeroAddress"
            );
          });

          it("should succeed", async () => {
            expect(await poolManager.closeRevenuePool()).to.eq(await revenuePool.getAddress());
            await expect(poolManager.connect(admin).updateCloseRevenuePool(deployer.address))
              .to.emit(poolManager, "UpdateCloseRevenuePool")
              .withArgs(await revenuePool.getAddress(), deployer.address);
            expect(await poolManager.closeRevenuePool()).to.eq(deployer.address);
          });
        });

        context("#updateMiscRevenuePool", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateMiscRevenuePool(ZeroAddress))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorZeroAddress", async () => {
            await expect(poolManager.connect(admin).updateMiscRevenuePool(ZeroAddress)).to.revertedWithCustomError(
              pool,
              "ErrorZeroAddress"
            );
          });

          it("should succeed", async () => {
            expect(await poolManager.miscRevenuePool()).to.eq(await revenuePool.getAddress());
            await expect(poolManager.connect(admin).updateMiscRevenuePool(deployer.address))
              .to.emit(poolManager, "UpdateMiscRevenuePool")
              .withArgs(await revenuePool.getAddress(), deployer.address);
            expect(await poolManager.miscRevenuePool()).to.eq(deployer.address);
          });
        });

        context("#updateExpenseRatio", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateExpenseRatio(0, 0, 0))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorExpenseRatioTooLarge", async () => {
            await expect(
              poolManager.connect(admin).updateExpenseRatio(500000000n + 1n, 0n, 0n)
            ).to.revertedWithCustomError(poolManager, "ErrorExpenseRatioTooLarge");
            await expect(
              poolManager.connect(admin).updateExpenseRatio(0n, 500000000n + 1n, 0n)
            ).to.revertedWithCustomError(poolManager, "ErrorExpenseRatioTooLarge");
            await expect(
              poolManager.connect(admin).updateExpenseRatio(0n, 0n, 500000000n + 1n)
            ).to.revertedWithCustomError(poolManager, "ErrorExpenseRatioTooLarge");
          });

          it("should succeed", async () => {
            expect(await poolManager.getFundingExpenseRatio()).to.eq(ethers.parseUnits("0.1", 9));
            expect(await poolManager.getRewardsExpenseRatio()).to.eq(ethers.parseUnits("0.1", 9));
            expect(await poolManager.getLiquidationExpenseRatio()).to.eq(ethers.parseUnits("0.1", 9));
            await expect(poolManager.connect(admin).updateExpenseRatio(0n, 500000000n, 0n))
              .to.emit(poolManager, "UpdateFundingExpenseRatio")
              .withArgs(ethers.parseUnits("0.1", 9), 500000000n);
            expect(await poolManager.getFundingExpenseRatio()).to.eq(500000000n);
            expect(await poolManager.getRewardsExpenseRatio()).to.eq(0n);
            expect(await poolManager.getLiquidationExpenseRatio()).to.eq(0n);
            await expect(poolManager.connect(admin).updateExpenseRatio(500000000n, 0n, 0n))
              .to.emit(poolManager, "UpdateRewardsExpenseRatio")
              .withArgs(0n, 500000000n);
            expect(await poolManager.getFundingExpenseRatio()).to.eq(0n);
            expect(await poolManager.getRewardsExpenseRatio()).to.eq(500000000n);
            expect(await poolManager.getLiquidationExpenseRatio()).to.eq(0n);
            await expect(poolManager.connect(admin).updateExpenseRatio(0n, 0n, 500000000n))
              .to.emit(poolManager, "UpdateLiquidationExpenseRatio")
              .withArgs(0n, 500000000n);
            expect(await poolManager.getFundingExpenseRatio()).to.eq(0n);
            expect(await poolManager.getRewardsExpenseRatio()).to.eq(0n);
            expect(await poolManager.getLiquidationExpenseRatio()).to.eq(500000000n);
          });
        });

        context("#updateHarvesterRatio", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateHarvesterRatio(0))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorHarvesterRatioTooLarge", async () => {
            await expect(poolManager.connect(admin).updateHarvesterRatio(200000000n + 1n)).to.revertedWithCustomError(
              poolManager,
              "ErrorHarvesterRatioTooLarge"
            );
          });

          it("should succeed", async () => {
            expect(await poolManager.getHarvesterRatio()).to.eq(ethers.parseUnits("0.01", 9));
            await expect(poolManager.connect(admin).updateHarvesterRatio(200000000n))
              .to.emit(poolManager, "UpdateHarvesterRatio")
              .withArgs(ethers.parseUnits("0.01", 9), 200000000n);
            expect(await poolManager.getHarvesterRatio()).to.eq(200000000n);
          });
        });

        context("#updateFlashLoanFeeRatio", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateFlashLoanFeeRatio(0))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorFlashLoanFeeRatioTooLarge", async () => {
            await expect(
              poolManager.connect(admin).updateFlashLoanFeeRatio(100000000n + 1n)
            ).to.revertedWithCustomError(poolManager, "ErrorFlashLoanFeeRatioTooLarge");
          });

          it("should succeed", async () => {
            expect(await poolManager.getFlashLoanFeeRatio()).to.eq(ethers.parseUnits("0.0001", 9));
            await expect(poolManager.connect(admin).updateFlashLoanFeeRatio(100000000n))
              .to.emit(poolManager, "UpdateFlashLoanFeeRatio")
              .withArgs(ethers.parseUnits("0.0001", 9), 100000000n);
            expect(await poolManager.getFlashLoanFeeRatio()).to.eq(100000000n);
          });
        });

        context("#updateRedeemFeeRatio", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateRedeemFeeRatio(0))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorRedeemFeeRatioTooLarge", async () => {
            await expect(poolManager.connect(admin).updateRedeemFeeRatio(100000000n + 1n)).to.revertedWithCustomError(
              poolManager,
              "ErrorRedeemFeeRatioTooLarge"
            );
          });

          it("should succeed", async () => {
            expect(await poolManager.getRedeemFeeRatio()).to.eq(0n);
            await expect(poolManager.connect(admin).updateRedeemFeeRatio(100000000n))
              .to.emit(poolManager, "UpdateRedeemFeeRatio")
              .withArgs(0n, 100000000n);
            expect(await poolManager.getRedeemFeeRatio()).to.eq(100000000n);
          });
        });

        context("#registerPool", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).registerPool(ZeroAddress, ZeroAddress, 0n, 0n))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorInvalidPool", async () => {
            const PoolManager = await ethers.getContractFactory("PoolManager", deployer);
            const fakePoolManager = await PoolManager.deploy(ZeroAddress, ZeroAddress, ZeroAddress);
            const AaveFundingPool = await ethers.getContractFactory("AaveFundingPool", admin);
            const fakePool = await AaveFundingPool.deploy(
              fakePoolManager.getAddress(),
              mockAaveV3Pool.getAddress(),
              stableToken.getAddress()
            );
            await expect(
              poolManager.connect(admin).registerPool(fakePool.getAddress(), ZeroAddress, 0n, 0n)
            ).to.revertedWithCustomError(poolManager, "ErrorInvalidPool");
          });

          it("should succeed", async () => {
            const AaveFundingPool = await ethers.getContractFactory("AaveFundingPool", admin);
            const newPool = await AaveFundingPool.deploy(
              poolManager.getAddress(),
              mockAaveV3Pool.getAddress(),
              stableToken.getAddress()
            );

            await expect(poolManager.connect(admin).registerPool(newPool.getAddress(), rewarder.getAddress(), 1n, 2n))
              .to.emit(poolManager, "RegisterPool")
              .withArgs(await newPool.getAddress())
              .to.emit(poolManager, "UpdatePoolCapacity")
              .withArgs(await newPool.getAddress(), 1n, 2n)
              .to.emit(poolManager, "UpdateRewardSplitter")
              .withArgs(await newPool.getAddress(), ZeroAddress, await rewarder.getAddress());
            expect(await poolManager.getPoolInfo(await newPool.getAddress())).to.deep.eq([1n, 0n, 0n, 2n, 0n]);
          });

          it("should succeed when register again", async () => {
            await expect(poolManager.connect(admin).registerPool(pool.getAddress(), rewarder.getAddress(), 1n, 2n))
              .to.not.emit(poolManager, "RegisterPool")
              .to.not.emit(poolManager, "UpdatePoolCapacity")
              .to.not.emit(poolManager, "UpdateRewardSplitter");
            expect(await poolManager.getPoolInfo(await pool.getAddress())).to.deep.eq([
              ethers.parseUnits("10000", tokenDecimals),
              0n,
              0n,
              ethers.parseEther("10000000"),
              0n,
            ]);
          });
        });

        context("#updateRateProvider", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateRateProvider(ZeroAddress, ZeroAddress))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should succeed", async () => {
            await expect(
              poolManager.connect(admin).updateRateProvider(stableToken.getAddress(), mockRateProvider.getAddress())
            )
              .to.emit(poolManager, "UpdateTokenRate")
              .withArgs(await stableToken.getAddress(), 10n ** 12n, await mockRateProvider.getAddress());
            expect(await poolManager.tokenRates(await stableToken.getAddress())).to.deep.eq([
              10n ** 12n,
              await mockRateProvider.getAddress(),
            ]);
            await expect(poolManager.connect(admin).updateRateProvider(stableToken.getAddress(), ZeroAddress))
              .to.emit(poolManager, "UpdateTokenRate")
              .withArgs(await stableToken.getAddress(), 10n ** 12n, ZeroAddress);
            expect(await poolManager.tokenRates(await stableToken.getAddress())).to.deep.eq([10n ** 12n, ZeroAddress]);
            await expect(poolManager.connect(admin).updateRateProvider(collateralToken.getAddress(), ZeroAddress))
              .to.emit(poolManager, "UpdateTokenRate")
              .withArgs(await collateralToken.getAddress(), TokenScale, ZeroAddress);
            expect(await poolManager.tokenRates(await collateralToken.getAddress())).to.deep.eq([
              TokenScale,
              ZeroAddress,
            ]);
            await expect(
              poolManager.connect(admin).updateRateProvider(collateralToken.getAddress(), mockRateProvider.getAddress())
            )
              .to.emit(poolManager, "UpdateTokenRate")
              .withArgs(await collateralToken.getAddress(), TokenScale, await mockRateProvider.getAddress());
            expect(await poolManager.tokenRates(await collateralToken.getAddress())).to.deep.eq([
              TokenScale,
              await mockRateProvider.getAddress(),
            ]);
          });
        });

        context("#updateRewardSplitter", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateRewardSplitter(ZeroAddress, ZeroAddress))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorPoolNotRegistered", async () => {
            await expect(
              poolManager.connect(admin).updateRewardSplitter(ZeroAddress, ZeroAddress)
            ).to.revertedWithCustomError(poolManager, "ErrorPoolNotRegistered");
          });

          it("should succeed", async () => {
            await expect(poolManager.connect(admin).updateRewardSplitter(pool.getAddress(), ZeroAddress))
              .to.emit(poolManager, "UpdateRewardSplitter")
              .withArgs(await pool.getAddress(), await rewarder.getAddress(), ZeroAddress);
            expect(await poolManager.rewardSplitter(pool.getAddress())).to.eq(ZeroAddress);
            await expect(poolManager.connect(admin).updateRewardSplitter(pool.getAddress(), rewarder.getAddress()))
              .to.emit(poolManager, "UpdateRewardSplitter")
              .withArgs(await pool.getAddress(), ZeroAddress, await rewarder.getAddress());
            expect(await poolManager.rewardSplitter(pool.getAddress())).to.eq(await rewarder.getAddress());
          });
        });

        context("#updatePoolCapacity", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updatePoolCapacity(ZeroAddress, 0n, 0n))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorPoolNotRegistered", async () => {
            await expect(poolManager.connect(admin).updatePoolCapacity(ZeroAddress, 0n, 0n)).to.revertedWithCustomError(
              poolManager,
              "ErrorPoolNotRegistered"
            );
          });

          it("should succeed", async () => {
            expect(await poolManager.getPoolInfo(await pool.getAddress())).to.deep.eq([
              ethers.parseUnits("10000", tokenDecimals),
              0n,
              0n,
              ethers.parseEther("10000000"),
              0n,
            ]);
            await expect(poolManager.connect(admin).updatePoolCapacity(pool.getAddress(), 1n, 2n))
              .to.emit(poolManager, "UpdatePoolCapacity")
              .withArgs(await pool.getAddress(), 1n, 2n);
            expect(await poolManager.getPoolInfo(await pool.getAddress())).to.deep.eq([1n, 0n, 0n, 2n, 0n]);
          });
        });

        context("#updateThreshold", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateThreshold(0))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should succeed", async () => {
            expect(await poolManager.permissionedLiquidationThreshold()).to.eq(ethers.parseEther("10000"));
            await expect(poolManager.connect(admin).updateThreshold(ethers.parseEther("1000")))
              .to.emit(poolManager, "UpdatePermissionedLiquidationThreshold")
              .withArgs(ethers.parseEther("10000"), ethers.parseEther("1000"));
            expect(await poolManager.permissionedLiquidationThreshold()).to.eq(ethers.parseEther("1000"));
          });
        });
      });

      context("operate", async () => {
        beforeEach(async () => {
          await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
          await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);
        });

        it("should revert, when ErrorPoolNotRegistered", async () => {
          await expect(poolManager.connect(deployer).operate(ZeroAddress, 0n, 0n, 0n)).to.revertedWithCustomError(
            poolManager,
            "ErrorPoolNotRegistered"
          );
        });

        it("should revert, when ErrorCollateralExceedCapacity", async () => {
          const newRawColl = ethers.parseUnits("1", tokenDecimals);
          const protocolFees = newRawColl / 1000n;
          const newRawDebt = ethers.parseEther("2000");
          await poolManager.updatePoolCapacity(pool.getAddress(), newRawColl - protocolFees - 1n, newRawDebt);
          await expect(
            poolManager.connect(deployer).operate(pool.getAddress(), 0, newRawColl, newRawDebt)
          ).to.revertedWithCustomError(poolManager, "ErrorCollateralExceedCapacity");
        });

        it("should revert, when ErrorDebtExceedCapacity", async () => {
          const newRawColl = ethers.parseUnits("1", tokenDecimals);
          const newRawDebt = ethers.parseEther("2000");
          await poolManager.updatePoolCapacity(pool.getAddress(), newRawColl, newRawDebt - 1n);
          await expect(
            poolManager.connect(deployer).operate(pool.getAddress(), 0, newRawColl, newRawDebt)
          ).to.revertedWithCustomError(poolManager, "ErrorDebtExceedCapacity");
        });

        it("should succeed when open a new position", async () => {
          const newRawColl = ethers.parseUnits("1", tokenDecimals);
          const protocolFees = newRawColl / 1000n;
          const newRawDebt = ethers.parseEther("2000");
          await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

          const positionId = await poolManager
            .connect(deployer)
            .operate.staticCall(pool.getAddress(), 0, newRawColl, newRawDebt);
          expect(positionId).to.eq(1); // positionId

          const collateralBalanceBefore = await collateralToken.balanceOf(deployer.address);
          const poolCollateralBalanceBefore = await collateralToken.balanceOf(poolManager.getAddress());
          const fxusdBalanceBefore = await fxUSD.balanceOf(deployer.address);
          await expect(poolManager.connect(deployer).operate(pool.getAddress(), 0, newRawColl, newRawDebt))
            .to.emit(poolManager, "Operate")
            .withArgs(await pool.getAddress(), 1, newRawColl - protocolFees, newRawDebt, protocolFees);
          const collateralBalanceAfter = await collateralToken.balanceOf(deployer.address);
          const poolCollateralBalanceAfter = await collateralToken.balanceOf(poolManager.getAddress());
          const fxusdBalanceAfter = await fxUSD.balanceOf(deployer.address);

          expect(collateralBalanceBefore - collateralBalanceAfter).to.eq(newRawColl);
          expect(poolCollateralBalanceAfter - poolCollateralBalanceBefore).to.eq(newRawColl);
          expect(fxusdBalanceAfter - fxusdBalanceBefore).to.eq(newRawDebt);

          expect(await poolManager.accumulatedPoolOpenFees(pool.getAddress())).to.eq(newRawColl / 1000n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).collateralBalance).to.eq(newRawColl - protocolFees);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
          expect((await poolManager.getPoolInfo(pool.getAddress())).debtBalance).to.eq(newRawDebt);
        });

        context("operate on old position", async () => {
          const InitialRawCollateral = ethers.parseUnits("1", tokenDecimals);
          const InitialProtocolFees = InitialRawCollateral / 1000n;
          const InitialRawDebt = ethers.parseEther("2000");

          beforeEach(async () => {
            await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);
            await poolManager.connect(deployer).operate(pool.getAddress(), 0, InitialRawCollateral, InitialRawDebt);
          });

          it("should succeed to add collateral", async () => {
            const rawColl = ethers.parseUnits("0.01", tokenDecimals);
            const protocolFees = rawColl / 1000n;
            const deployerBalanceBefore = await collateralToken.balanceOf(deployer.address);
            await expect(poolManager.connect(deployer).operate(pool.getAddress(), 1, rawColl, 0n)).to.emit(
              poolManager,
              "Operate"
            );
            const deployerBalanceAfter = await collateralToken.balanceOf(deployer.address);
            expect(deployerBalanceBefore - deployerBalanceAfter).to.eq(rawColl);

            expect(await poolManager.accumulatedPoolOpenFees(pool.getAddress())).to.eq(
              InitialProtocolFees + protocolFees
            );
            expect((await poolManager.getPoolInfo(pool.getAddress())).collateralBalance).to.eq(
              InitialRawCollateral - InitialProtocolFees + rawColl - protocolFees
            );
            expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
              await pool.getTotalRawCollaterals()
            );
            expect((await poolManager.getPoolInfo(pool.getAddress())).debtBalance).to.eq(InitialRawDebt);
          });

          it("should succeed to remove collateral", async () => {
            const rawColl = ethers.parseUnits("0.01", tokenDecimals);
            const protocolFees = rawColl / 1000n;
            const deployerBalanceBefore = await collateralToken.balanceOf(deployer.address);
            await expect(poolManager.connect(deployer).operate(pool.getAddress(), 1, -rawColl, 0n)).to.emit(
              poolManager,
              "Operate"
            );
            const deployerBalanceAfter = await collateralToken.balanceOf(deployer.address);
            expect(deployerBalanceAfter - deployerBalanceBefore).to.eq(rawColl - protocolFees);

            expect(await poolManager.accumulatedPoolCloseFees(pool.getAddress())).to.eq(protocolFees);
            expect((await poolManager.getPoolInfo(pool.getAddress())).collateralBalance).to.eq(
              InitialRawCollateral - InitialProtocolFees - rawColl
            );
            expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
              await pool.getTotalRawCollaterals()
            );
            expect((await poolManager.getPoolInfo(pool.getAddress())).debtBalance).to.eq(InitialRawDebt);
          });

          it("should succeed to borrow debt", async () => {
            const rawDebt = ethers.parseEther("100");
            const fxusdBefore = await fxUSD.balanceOf(deployer);
            await expect(poolManager.connect(deployer).operate(pool.getAddress(), 1, 0n, rawDebt)).to.emit(
              poolManager,
              "Operate"
            );
            const fxusdAfter = await fxUSD.balanceOf(deployer);
            expect(fxusdAfter - fxusdBefore).to.eq(rawDebt);
            expect((await poolManager.getPoolInfo(pool.getAddress())).collateralBalance).to.eq(
              InitialRawCollateral - InitialProtocolFees
            );
            expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
              await pool.getTotalRawCollaterals()
            );
            expect((await poolManager.getPoolInfo(pool.getAddress())).debtBalance).to.eq(InitialRawDebt + rawDebt);
          });

          it("should succeed to repay debt", async () => {
            const rawDebt = ethers.parseEther("100");
            const fxusdBefore = await fxUSD.balanceOf(deployer);
            await expect(poolManager.connect(deployer).operate(pool.getAddress(), 1, 0n, -rawDebt)).to.emit(
              poolManager,
              "Operate"
            );
            const fxusdAfter = await fxUSD.balanceOf(deployer);
            expect(fxusdBefore - fxusdAfter).to.eq(rawDebt);
            expect((await poolManager.getPoolInfo(pool.getAddress())).collateralBalance).to.eq(
              InitialRawCollateral - InitialProtocolFees
            );
            expect((await poolManager.getPoolInfo(pool.getAddress())).debtBalance).to.eq(InitialRawDebt - rawDebt);
          });

          it("should succeed close entire position", async () => {
            // open another one to avoid ErrorPoolUnderCollateral
            await poolManager.connect(deployer).operate(pool.getAddress(), 0, InitialRawCollateral, InitialRawDebt);
            await poolManager.connect(deployer).operate(pool.getAddress(), 1, MinInt256, MinInt256);
            expect(await pool.getPosition(1)).to.deep.eq([0n, 0n]);
            expect((await poolManager.getPoolInfo(pool.getAddress())).collateralBalance).to.eq(
              InitialRawCollateral - InitialProtocolFees
            );
            expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
              await pool.getTotalRawCollaterals()
            );
            expect((await poolManager.getPoolInfo(pool.getAddress())).debtBalance).to.eq(InitialRawDebt);
          });
        });
      });

      context("redeem", async () => {
        beforeEach(async () => {
          // max redeem 20% per tick
          await pool.connect(admin).updateMaxRedeemRatioPerTick(ethers.parseUnits("0.2", 9));
          // remove open fee
          await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
          // set redeem fee 1%
          await poolManager.updateRedeemFeeRatio(ethers.parseUnits("0.01", 9));
          await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);

          await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
          await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

          const InitialRawCollateral = ethers.parseUnits("1", tokenDecimals);
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, InitialRawCollateral, ethers.parseEther("2200"));
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, InitialRawCollateral, ethers.parseEther("2100"));
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, InitialRawCollateral, ethers.parseEther("2000"));
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, InitialRawCollateral, ethers.parseEther("1900"));

          expect(await pool.getTopTick()).to.eq(4997);
        });

        it("should revert, when ErrorPoolNotRegistered", async () => {
          await expect(poolManager.connect(deployer).redeem(ZeroAddress, 0n, 0n)).to.revertedWithCustomError(
            poolManager,
            "ErrorPoolNotRegistered"
          );
        });

        it("should revert, when ErrorRedeemExceedBalance", async () => {
          const balance = await fxUSD.balanceOf(deployer.address);
          await expect(
            poolManager.connect(deployer).redeem(pool.getAddress(), balance + 1n, 0n)
          ).to.revertedWithCustomError(poolManager, "ErrorRedeemExceedBalance");
        });

        it("should succeed, when redeem only in one position", async () => {
          // max price is 3001, redeem 440, get 0.146617794068643785 / 1.23 = 0.119201458592393321
          const debtsToRedeem = ethers.parseEther("440");
          const collateralRedeemed = ethers.parseEther("0.119201458592393321") / TokenScale;
          const fees = collateralRedeemed / 100n;
          const expected = await poolManager.connect(deployer).redeem.staticCall(pool.getAddress(), debtsToRedeem, 0n);
          expect(expected).to.eq(collateralRedeemed - fees);

          await expect(
            poolManager.connect(deployer).redeem(pool.getAddress(), debtsToRedeem, expected + 1n)
          ).to.revertedWithCustomError(poolManager, "ErrorInsufficientRedeemedCollateral");

          expect(await pool.getPosition(1)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2200")]);
          expect(await pool.getPosition(2)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2100")]);
          expect(await pool.getTotalRawCollaterals()).to.eq(ethers.parseEther("1.23") * 4n);
          expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("8200"));
          const feesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const fxusdBefore = await fxUSD.balanceOf(deployer.address);
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await poolManager.connect(deployer).redeem(pool.getAddress(), debtsToRedeem, expected);
          const feesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const fxusdAfter = await fxUSD.balanceOf(deployer.address);
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(feesAfter - feesBefore).to.eq(fees);
          expect(fxusdBefore - fxusdAfter).to.eq(debtsToRedeem);
          expect(collateralAfter - collateralBefore).to.eq(collateralRedeemed - fees);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(collateralRedeemed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(debtsToRedeem);
          expect(await pool.getPosition(2)).to.deep.eq([ethers.parseEther("1.23"), ethers.parseEther("2100")]);
          expect((await pool.getPosition(1)).rawColls).to.closeTo(ethers.parseEther("1.083382205931356215"), 10n);
          expect((await pool.getPosition(1)).rawDebts).to.closeTo(ethers.parseEther("1760"), 1000000n);
          expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("4.773382205931356215"), 10n);
          expect(await pool.getTotalRawDebts()).to.eq(ethers.parseEther("7760"));
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
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
          await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);

          // open 3 positions on the same tick
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, ethers.parseUnits("0.1", tokenDecimals), ethers.parseEther("220"));
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, ethers.parseUnits("1", tokenDecimals), ethers.parseEther("2200"));
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, ethers.parseUnits("10", tokenDecimals), ethers.parseEther("22000"));
          expect(await pool.getNextTreeNodeId()).to.eq(2);
          expect(await pool.getTopTick()).to.eq(4997);
        });

        it("should revert, when ErrorPoolNotRegistered", async () => {
          await expect(
            poolManager
              .connect(deployer)
              ["rebalance(address,address,int16,uint256,uint256)"](ZeroAddress, ZeroAddress, 0n, 0n, 0n)
          ).to.revertedWithCustomError(poolManager, "ErrorPoolNotRegistered");
        });

        it("should revert, when ErrorCallerNotFxUSDSave", async () => {
          await poolManager.updateThreshold(0);
          await expect(
            poolManager
              .connect(deployer)
              ["rebalance(address,address,int16,uint256,uint256)"](pool.getAddress(), ZeroAddress, 0n, 0n, 0n)
          ).to.revertedWithCustomError(poolManager, "ErrorCallerNotFxUSDSave");
        });

        it("should succeed, only use fxUSD", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 2000, debt ratio became 0.894308943089430894
          // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
          // bonus = 0.040517670482827278, revenue pool part = 0.004051767048282727
          // raw debts = 3986.938775510204081632
          // fxusd = 3986.938775510204081632
          await mockPriceOracle.setPrices(
            ethers.parseEther("2000"),
            ethers.parseEther("2000"),
            ethers.parseEther("2000")
          );

          // rebalance to 0.88
          await fxUSD.connect(deployer).transfer(fxBASE.getAddress(), await fxUSD.balanceOf(deployer.address));
          const result = await fxBASE["rebalance(address,int16,uint256,uint256)"].staticCall(
            pool.getAddress(),
            4997,
            MaxUint256,
            0n
          );
          const fxusdBefore = await fxUSD.balanceOf(fxBASE.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const poolFeesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await fxBASE
            .connect(deployer)
            ["rebalance(address,int16,uint256,uint256)"](pool.getAddress(), 4997, MaxUint256, 0n);
          const fxusdAfter = await fxUSD.balanceOf(fxBASE.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const poolFeesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(fxusdBefore - fxusdAfter).to.eq(result.yieldTokenUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(result.yieldTokenUsed);
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(result.colls + poolFeesAfter - poolFeesBefore);
          expect(poolFeesAfter - poolFeesBefore).to.eq(ethers.parseEther("0.004051767048282727") / TokenScale);
          expect(result.colls).to.eq(ethers.parseEther("1.657172722747635639") / TokenScale);
          expect(result.yieldTokenUsed).to.eq(ethers.parseEther("3986.938775510204081632"));
          expect(result.stableTokenUsed).to.eq(0n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });

        it("should succeed, only use stable", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 2000, debt ratio became 0.894308943089430894
          // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
          // raw debts = 3986.938775510204081632
          // fxusd = 0
          // stable = 3986.938775510204081632 / 0.991 = 4023.147099404847711031
          await mockPriceOracle.setPrices(
            ethers.parseEther("2000"),
            ethers.parseEther("2000"),
            ethers.parseEther("2000")
          );

          // rebalance to 0.88
          await stableToken.mint(fxBASE.getAddress(), ethers.parseEther("1000000"));
          const result = await fxBASE["rebalance(address,int16,uint256,uint256)"].staticCall(
            pool.getAddress(),
            4997,
            0n,
            ethers.parseEther("1000000")
          );
          const stableBefore = await stableToken.balanceOf(fxBASE.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const poolFeesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await fxBASE
            .connect(deployer)
            ["rebalance(address,int16,uint256,uint256)"](pool.getAddress(), 4997, 0n, ethers.parseEther("1000000"));
          const stableAfter = await stableToken.balanceOf(fxBASE.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const poolFeesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(stableBefore - stableAfter).to.eq(result.stableTokenUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(ethers.parseEther("3986.938775510204081632"));
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(result.colls + poolFeesAfter - poolFeesBefore);
          expect(poolFeesAfter - poolFeesBefore).to.eq(ethers.parseEther("0.004051767048282727") / TokenScale);
          expect(result.colls).to.eq(ethers.parseEther("1.657172722747635639") / TokenScale);
          expect(result.stableTokenUsed).to.eq(ethers.parseUnits("4023.147100", 6)); // rounding up
          expect(result.yieldTokenUsed).to.eq(0n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });

        it("should succeed, use fxUSD + stable", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 2000, debt ratio became 0.894308943089430894
          // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
          // raw debts = 3986.938775510204081632
          // fxusd = 2000
          // stable = 1986.938775510204081632 / 0.991 = 2004.983628163677176217
          await mockPriceOracle.setPrices(
            ethers.parseEther("2000"),
            ethers.parseEther("2000"),
            ethers.parseEther("2000")
          );

          // rebalance to 0.88
          await fxUSD.connect(deployer).transfer(fxBASE.getAddress(), await fxUSD.balanceOf(deployer.address));
          await stableToken.mint(fxBASE.getAddress(), ethers.parseEther("1000000"));
          const result = await fxBASE["rebalance(address,int16,uint256,uint256)"].staticCall(
            pool.getAddress(),
            4997,
            ethers.parseEther("2000"),
            ethers.parseEther("1000000")
          );
          const stableBefore = await stableToken.balanceOf(fxBASE.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const poolFeesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await fxBASE
            .connect(deployer)
            ["rebalance(address,int16,uint256,uint256)"](
              pool.getAddress(),
              4997,
              ethers.parseEther("2000"),
              ethers.parseEther("1000000")
            );
          const stableAfter = await stableToken.balanceOf(fxBASE.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const poolFeesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(stableBefore - stableAfter).to.eq(result.stableTokenUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(ethers.parseEther("3986.938775510204081632"));
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(result.colls + poolFeesAfter - poolFeesBefore);
          expect(poolFeesAfter - poolFeesBefore).to.eq(ethers.parseEther("0.004051767048282727") / TokenScale);
          expect(result.colls).to.eq(ethers.parseEther("1.657172722747635639") / TokenScale);
          expect(result.stableTokenUsed).to.eq(ethers.parseUnits("2004.983629", 6)); // rounding up
          expect(result.yieldTokenUsed).to.eq(ethers.parseEther("2000"));
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });

        it("should succeed, when fxUSD < 10000, stable = 0 in fxBASE", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 2000, debt ratio became 0.894308943089430894
          // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
          // bonus = 0.040517670482827278, revenue pool part = 0.004051767048282727
          // raw debts = 3986.938775510204081632
          // fxusd = 3986.938775510204081632
          await mockPriceOracle.setPrices(
            ethers.parseEther("2000"),
            ethers.parseEther("2000"),
            ethers.parseEther("2000")
          );

          // rebalance to 0.88
          await fxUSD.connect(deployer).transfer(fxBASE.getAddress(), ethers.parseEther("10000") - 1n);
          const result = await poolManager
            .connect(deployer)
            ["rebalance(address,address,int16,uint256,uint256)"].staticCall(
              pool.getAddress(),
              deployer.address,
              4997,
              MaxUint256,
              0n
            );
          const fxusdBefore = await fxUSD.balanceOf(deployer.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const poolFeesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await poolManager
            .connect(deployer)
            ["rebalance(address,address,int16,uint256,uint256)"](
              pool.getAddress(),
              deployer.address,
              4997,
              MaxUint256,
              0n
            );
          const fxusdAfter = await fxUSD.balanceOf(deployer.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const poolFeesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(fxusdBefore - fxusdAfter).to.eq(result.fxUSDUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(result.fxUSDUsed);
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(result.colls + poolFeesAfter - poolFeesBefore);
          expect(poolFeesAfter - poolFeesBefore).to.eq(ethers.parseEther("0.004051767048282727") / TokenScale);
          expect(result.colls).to.eq(ethers.parseEther("1.657172722747635639") / TokenScale);
          expect(result.fxUSDUsed).to.eq(ethers.parseEther("3986.938775510204081632"));
          expect(result.stableUsed).to.eq(0n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });

        it("should succeed, when fxUSD = 0, stable < 10000 in fxBASE", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 2000, debt ratio became 0.894308943089430894
          // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
          // bonus = 0.040517670482827278, revenue pool part = 0.004051767048282727
          // raw debts = 3986.938775510204081632
          // fxusd = 3986.938775510204081632
          await mockPriceOracle.setPrices(
            ethers.parseEther("2000"),
            ethers.parseEther("2000"),
            ethers.parseEther("2000")
          );

          // rebalance to 0.88
          await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.99999999", 8));
          await stableToken.connect(deployer).mint(fxBASE.getAddress(), ethers.parseUnits("10000", 6));
          const result = await poolManager
            .connect(deployer)
            ["rebalance(address,address,int16,uint256,uint256)"].staticCall(
              pool.getAddress(),
              deployer.address,
              4997,
              MaxUint256,
              0n
            );
          const fxusdBefore = await fxUSD.balanceOf(deployer.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const poolFeesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await poolManager
            .connect(deployer)
            ["rebalance(address,address,int16,uint256,uint256)"](
              pool.getAddress(),
              deployer.address,
              4997,
              MaxUint256,
              0n
            );
          const fxusdAfter = await fxUSD.balanceOf(deployer.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const poolFeesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(fxusdBefore - fxusdAfter).to.eq(result.fxUSDUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(result.fxUSDUsed);
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(result.colls + poolFeesAfter - poolFeesBefore);
          expect(poolFeesAfter - poolFeesBefore).to.eq(ethers.parseEther("0.004051767048282727") / TokenScale);
          expect(result.colls).to.eq(ethers.parseEther("1.657172722747635639") / TokenScale);
          expect(result.fxUSDUsed).to.eq(ethers.parseEther("3986.938775510204081632"));
          expect(result.stableUsed).to.eq(0n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });
      });

      context("batch rebalance", async () => {
        beforeEach(async () => {
          await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.991", 8));

          await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
          await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

          // remove open fee
          await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
          await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);

          // open 3 positions on the same tick
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, ethers.parseUnits("0.1", tokenDecimals), ethers.parseEther("220"));
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, ethers.parseUnits("1", tokenDecimals), ethers.parseEther("2200"));
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, ethers.parseUnits("10", tokenDecimals), ethers.parseEther("22000"));
          expect(await pool.getNextTreeNodeId()).to.eq(2);
          expect(await pool.getTopTick()).to.eq(4997);
        });

        it("should revert, when ErrorPoolNotRegistered", async () => {
          await expect(
            poolManager
              .connect(deployer)
              ["rebalance(address,address,uint256,uint256)"](ZeroAddress, ZeroAddress, 0n, 0n)
          ).to.revertedWithCustomError(poolManager, "ErrorPoolNotRegistered");
        });

        it("should revert, when ErrorCallerNotFxUSDSave", async () => {
          await poolManager.updateThreshold(0);
          await expect(
            poolManager
              .connect(deployer)
              ["rebalance(address,address,uint256,uint256)"](pool.getAddress(), ZeroAddress, 0n, 0n)
          ).to.revertedWithCustomError(poolManager, "ErrorCallerNotFxUSDSave");
        });

        it("should succeed, only use fxUSD", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 2000, debt ratio became 0.894308943089430894
          // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
          // bonus = 0.040517670482827278, revenue pool part = 0.004051767048282727
          // raw debts = 3986.938775510204081632
          // fxusd = 3986.938775510204081632
          await mockPriceOracle.setPrices(
            ethers.parseEther("2000"),
            ethers.parseEther("2000"),
            ethers.parseEther("2000")
          );

          // rebalance to 0.88
          await fxUSD.connect(deployer).transfer(fxBASE.getAddress(), await fxUSD.balanceOf(deployer.address));
          const result = await fxBASE["rebalance(address,uint256,uint256)"].staticCall(
            pool.getAddress(),
            MaxUint256,
            0n
          );
          const fxusdBefore = await fxUSD.balanceOf(fxBASE.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const poolFeesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await fxBASE.connect(deployer)["rebalance(address,uint256,uint256)"](pool.getAddress(), MaxUint256, 0n);
          const fxusdAfter = await fxUSD.balanceOf(fxBASE.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const poolFeesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(fxusdBefore - fxusdAfter).to.eq(result.yieldTokenUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(result.yieldTokenUsed);
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(result.colls + poolFeesAfter - poolFeesBefore);
          expect(poolFeesAfter - poolFeesBefore).to.eq(ethers.parseEther("0.004051767048282727") / TokenScale);
          expect(result.colls).to.eq(ethers.parseEther("1.657172722747635639") / TokenScale);
          expect(result.yieldTokenUsed).to.eq(ethers.parseEther("3986.938775510204081632"));
          expect(result.stableTokenUsed).to.eq(0n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });

        it("should succeed, only use stable", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 2000, debt ratio became 0.894308943089430894
          // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
          // raw debts = 3986.938775510204081632
          // fxusd = 0
          // stable = 3986.938775510204081632 / 0.991 = 4023.147099404847711031
          await mockPriceOracle.setPrices(
            ethers.parseEther("2000"),
            ethers.parseEther("2000"),
            ethers.parseEther("2000")
          );

          // rebalance to 0.88
          await stableToken.mint(fxBASE.getAddress(), ethers.parseEther("1000000"));
          const result = await fxBASE["rebalance(address,uint256,uint256)"].staticCall(
            pool.getAddress(),
            0n,
            ethers.parseEther("1000000")
          );
          const stableBefore = await stableToken.balanceOf(fxBASE.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const poolFeesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await fxBASE
            .connect(deployer)
            ["rebalance(address,uint256,uint256)"](pool.getAddress(), 0n, ethers.parseEther("1000000"));
          const stableAfter = await stableToken.balanceOf(fxBASE.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const poolFeesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(stableBefore - stableAfter).to.eq(result.stableTokenUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(ethers.parseEther("3986.938775510204081632"));
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(result.colls + poolFeesAfter - poolFeesBefore);
          expect(poolFeesAfter - poolFeesBefore).to.eq(ethers.parseEther("0.004051767048282727") / TokenScale);
          expect(result.colls).to.eq(ethers.parseEther("1.657172722747635639") / TokenScale);
          expect(result.stableTokenUsed).to.eq(ethers.parseUnits("4023.147100", 6)); // rounding up
          expect(result.yieldTokenUsed).to.eq(0n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });

        it("should succeed, use fxUSD + stable", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 2000, debt ratio became 0.894308943089430894
          // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
          // raw debts = 3986.938775510204081632
          // fxusd = 2000
          // stable = 1986.938775510204081632 / 0.991 = 2004.983628163677176217
          await mockPriceOracle.setPrices(
            ethers.parseEther("2000"),
            ethers.parseEther("2000"),
            ethers.parseEther("2000")
          );

          // rebalance to 0.88
          await fxUSD.connect(deployer).transfer(fxBASE.getAddress(), await fxUSD.balanceOf(deployer.address));
          await stableToken.mint(fxBASE.getAddress(), ethers.parseEther("1000000"));
          const result = await fxBASE["rebalance(address,uint256,uint256)"].staticCall(
            pool.getAddress(),
            ethers.parseEther("2000"),
            ethers.parseEther("1000000")
          );
          const stableBefore = await stableToken.balanceOf(fxBASE.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const poolFeesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await fxBASE
            .connect(deployer)
            ["rebalance(address,uint256,uint256)"](
              pool.getAddress(),
              ethers.parseEther("2000"),
              ethers.parseEther("1000000")
            );
          const stableAfter = await stableToken.balanceOf(fxBASE.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const poolFeesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(stableBefore - stableAfter).to.eq(result.stableTokenUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(ethers.parseEther("3986.938775510204081632"));
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(result.colls + poolFeesAfter - poolFeesBefore);
          expect(poolFeesAfter - poolFeesBefore).to.eq(ethers.parseEther("0.004051767048282727") / TokenScale);
          expect(result.colls).to.eq(ethers.parseEther("1.657172722747635639") / TokenScale);
          expect(result.stableTokenUsed).to.eq(ethers.parseUnits("2004.983629", 6)); // rounding up
          expect(result.yieldTokenUsed).to.eq(ethers.parseEther("2000"));
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });

        it("should succeed, when fxUSD < 10000, stable = 0 in fxBASE", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 2000, debt ratio became 0.894308943089430894
          // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
          // bonus = 0.040517670482827278, revenue pool part = 0.004051767048282727
          // raw debts = 3986.938775510204081632
          // fxusd = 3986.938775510204081632
          await mockPriceOracle.setPrices(
            ethers.parseEther("2000"),
            ethers.parseEther("2000"),
            ethers.parseEther("2000")
          );

          // rebalance to 0.88
          await fxUSD.connect(deployer).transfer(fxBASE.getAddress(), ethers.parseEther("10000") - 1n);
          const result = await poolManager
            .connect(deployer)
            ["rebalance(address,address,uint256,uint256)"].staticCall(
              pool.getAddress(),
              deployer.address,
              MaxUint256,
              0n
            );
          const fxusdBefore = await fxUSD.balanceOf(deployer.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const poolFeesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await poolManager
            .connect(deployer)
            ["rebalance(address,address,uint256,uint256)"](pool.getAddress(), deployer.address, MaxUint256, 0n);
          const fxusdAfter = await fxUSD.balanceOf(deployer.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const poolFeesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(fxusdBefore - fxusdAfter).to.eq(result.fxUSDUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(result.fxUSDUsed);
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(result.colls + poolFeesAfter - poolFeesBefore);
          expect(poolFeesAfter - poolFeesBefore).to.eq(ethers.parseEther("0.004051767048282727") / TokenScale);
          expect(result.colls).to.eq(ethers.parseEther("1.657172722747635639") / TokenScale);
          expect(result.fxUSDUsed).to.eq(ethers.parseEther("3986.938775510204081632"));
          expect(result.stableUsed).to.eq(0n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });

        it("should succeed, when fxUSD = 0, stable < 10000 in fxBASE", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 2000, debt ratio became 0.894308943089430894
          // raw colls = 2.043306122448979591, colls = 2.043306122448979591 / 1.23 = 1.661224489795918366
          // bonus = 0.040517670482827278, revenue pool part = 0.004051767048282727
          // raw debts = 3986.938775510204081632
          // fxusd = 3986.938775510204081632
          await mockPriceOracle.setPrices(
            ethers.parseEther("2000"),
            ethers.parseEther("2000"),
            ethers.parseEther("2000")
          );

          // rebalance to 0.88
          await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.99999999", 8));
          await stableToken.connect(deployer).mint(fxBASE.getAddress(), ethers.parseUnits("10000", 6));
          const result = await poolManager
            .connect(deployer)
            ["rebalance(address,address,uint256,uint256)"].staticCall(
              pool.getAddress(),
              deployer.address,
              MaxUint256,
              0n
            );
          const fxusdBefore = await fxUSD.balanceOf(deployer.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const poolFeesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await poolManager
            .connect(deployer)
            ["rebalance(address,address,uint256,uint256)"](pool.getAddress(), deployer.address, MaxUint256, 0n);
          const fxusdAfter = await fxUSD.balanceOf(deployer.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const poolFeesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(fxusdBefore - fxusdAfter).to.eq(result.fxUSDUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(result.fxUSDUsed);
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(result.colls + poolFeesAfter - poolFeesBefore);
          expect(poolFeesAfter - poolFeesBefore).to.eq(ethers.parseEther("0.004051767048282727") / TokenScale);
          expect(result.colls).to.eq(ethers.parseEther("1.657172722747635639") / TokenScale);
          expect(result.fxUSDUsed).to.eq(ethers.parseEther("3986.938775510204081632"));
          expect(result.stableUsed).to.eq(0n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });
      });

      context("batch liquidate", async () => {
        beforeEach(async () => {
          await mockAggregatorV3Interface.setPrice(ethers.parseUnits("0.991", 8));

          await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
          await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);

          // remove open fee
          await pool.connect(admin).updateOpenRatio(0n, ethers.parseEther("1"));
          await pool.connect(admin).updateDebtRatioRange(0, ethers.parseEther("1"));
          await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);

          // open 3 positions on the same tick
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, ethers.parseUnits("0.1", tokenDecimals), ethers.parseEther("220"));
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, ethers.parseUnits("1", tokenDecimals), ethers.parseEther("1000"));
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, ethers.parseUnits("10", tokenDecimals), ethers.parseEther("10000"));
          expect(await pool.getNextTreeNodeId()).to.eq(3);
          expect(await pool.getTopTick()).to.eq(4997);
        });

        it("should revert, when ErrorPoolNotRegistered", async () => {
          await expect(
            poolManager.connect(deployer).liquidate(ZeroAddress, ZeroAddress, 0n, 0n)
          ).to.revertedWithCustomError(poolManager, "ErrorPoolNotRegistered");
        });

        it("should revert, when ErrorCallerNotFxUSDSave", async () => {
          await poolManager.updateThreshold(0);
          await expect(
            poolManager.connect(deployer).liquidate(pool.getAddress(), ZeroAddress, 0n, 0n)
          ).to.revertedWithCustomError(poolManager, "ErrorCallerNotFxUSDSave");
        });

        it("should ok, when collateral can cover bonus", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 1900, debt ratio became 0.941377834830979888
          // debts = 220
          // raw colls = 220/1900*1.05 = 0.121578947368421052, colls = 0.121578947368421052/1.23 = 0.098844672657252887
          await mockPriceOracle.setPrices(
            ethers.parseEther("1900"),
            ethers.parseEther("1900"),
            ethers.parseEther("1900")
          );

          // liquidate position 1
          await fxUSD.connect(deployer).transfer(fxBASE.getAddress(), await fxUSD.balanceOf(deployer.address));
          const result = await fxBASE.liquidate.staticCall(pool.getAddress(), MaxUint256, 0n);

          const fxusdBefore = await fxUSD.balanceOf(fxBASE.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const poolFeesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await fxBASE.connect(deployer).liquidate(pool.getAddress(), MaxUint256, 0n);
          const fxusdAfter = await fxUSD.balanceOf(fxBASE.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const poolFeesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(fxusdBefore - fxusdAfter).to.eq(result.yieldTokenUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(result.yieldTokenUsed);
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(result.colls + poolFeesAfter - poolFeesBefore);
          expect(poolFeesAfter - poolFeesBefore).to.eq(ethers.parseEther("0.000470688917415489") / TokenScale);
          expect(result.colls).to.closeTo(ethers.parseEther("0.098373983739837398") / TokenScale, 10n);
          expect(result.yieldTokenUsed).to.eq(ethers.parseEther("220"));
          expect(result.stableTokenUsed).to.eq(0n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });

        it("should ok, when collateral + reserve can cover bonus", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 1850, debt ratio became 0.966820479015600966
          // debts = 220
          // raw colls = 220/1850*1.05 = 0.124864864864864863, colls = 0.101516150296638100
          // colls from pool = 0.123/1.23 = 0.1
          // colls from reserve = (0.124864864864864863-0.123)/1.23 = 0.001516150296638100
          await mockPriceOracle.setPrices(
            ethers.parseEther("1850"),
            ethers.parseEther("1850"),
            ethers.parseEther("1850")
          );

          // liquidate position 1
          await fxUSD.connect(deployer).transfer(fxBASE.getAddress(), await fxUSD.balanceOf(deployer.address));
          await collateralToken.mint(reservePool.getAddress(), ethers.parseEther("1") / TokenScale);
          const result = await fxBASE.liquidate.staticCall(pool.getAddress(), MaxUint256, 0n);

          const fxusdBefore = await fxUSD.balanceOf(fxBASE.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const reservePoolBefore = await collateralToken.balanceOf(reservePool.getAddress());
          const poolFeesBefore = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await fxBASE.connect(deployer).liquidate(pool.getAddress(), MaxUint256, 0n);
          const fxusdAfter = await fxUSD.balanceOf(fxBASE.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const reservePoolAfter = await collateralToken.balanceOf(reservePool.getAddress());
          const poolFeesAfter = await poolManager.accumulatedPoolMiscFees(pool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(fxusdBefore - fxusdAfter).to.eq(result.yieldTokenUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(result.yieldTokenUsed);
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(reservePoolBefore - reservePoolAfter).to.eq(ethers.parseEther("0.001516150296638100") / TokenScale);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(ethers.parseEther("0.1") / TokenScale);
          expect(poolFeesAfter - poolFeesBefore).to.eq(ethers.parseEther("0.000483410239507800") / TokenScale);
          expect(result.colls).to.eq(ethers.parseEther("0.101032740057130300") / TokenScale);
          expect(result.yieldTokenUsed).to.eq(ethers.parseEther("220"));
          expect(result.stableTokenUsed).to.eq(0n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });

        it("should ok, when collateral + reserve cannot cover bonus", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 1850, debt ratio became 0.966820479015600966
          // debts = 220
          // raw colls = min(220/1850*1.05, 0.123+0.00123) = 0.12423, colls = 0.101
          // colls from pool = 0.123/1.23 = 0.1
          // colls from reserve = 0.00123/1.23 = 0.001
          await mockPriceOracle.setPrices(
            ethers.parseEther("1850"),
            ethers.parseEther("1850"),
            ethers.parseEther("1850")
          );
          await poolManager.connect(admin).updateExpenseRatio(0n, 0n, 0n);

          // liquidate position 1
          await fxUSD.connect(deployer).transfer(fxBASE.getAddress(), await fxUSD.balanceOf(deployer.address));
          await collateralToken.mint(reservePool.getAddress(), ethers.parseEther("0.001") / TokenScale);
          const result = await fxBASE.liquidate.staticCall(pool.getAddress(), MaxUint256, 0n);

          const fxusdBefore = await fxUSD.balanceOf(fxBASE.getAddress());
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const reservePoolBefore = await collateralToken.balanceOf(reservePool.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await fxBASE.connect(deployer).liquidate(pool.getAddress(), MaxUint256, 0n);
          const fxusdAfter = await fxUSD.balanceOf(fxBASE.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const reservePoolAfter = await collateralToken.balanceOf(reservePool.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(fxusdBefore - fxusdAfter).to.eq(result.yieldTokenUsed);
          expect(poolDebtBefore - poolDebtAfter).to.eq(result.yieldTokenUsed);
          expect(collateralAfter - collateralBefore).to.eq(result.colls);
          expect(reservePoolBefore - reservePoolAfter).to.eq(ethers.parseEther("0.001") / TokenScale);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(ethers.parseEther("0.1") / TokenScale);
          expect(result.colls).to.eq(ethers.parseEther("0.101") / TokenScale);
          expect(result.yieldTokenUsed).to.eq(ethers.parseEther("220"));
          expect(result.stableTokenUsed).to.eq(0n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );
        });
      });

      context("harvest", async () => {
        beforeEach(async () => {
          await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
          await collateralToken.connect(deployer).approve(poolManager.getAddress(), MaxUint256);
          await poolManager.grantRole(id("OPERATOR_ROLE"), deployer.address);

          // open 1 positions on the same tick
          await poolManager
            .connect(deployer)
            .operate(pool.getAddress(), 0, ethers.parseUnits("100", tokenDecimals), ethers.parseEther("220000"));
        });

        it("should succeed", async () => {
          // rate change from 1.23 to 1.3
          // rewards = ((100-0.1)*1.3 - (100-0.1)*1.23)/1.3 = 5.379230769230769230
          await mockRateProvider.setRate(ethers.parseEther("1.3"));
          await poolManager.grantRole(id("HARVESTER_ROLE"), deployer.address);

          const [rewards, funding] = await poolManager.connect(deployer).harvest.staticCall(pool.getAddress());
          expect(funding).to.eq(0n);
          expect(rewards).to.closeTo(ethers.parseEther("5.379230769230769230") / TokenScale, 10n);

          const accumulatedPoolFees = await poolManager.accumulatedPoolOpenFees(pool.getAddress());
          expect(accumulatedPoolFees).to.eq(ethers.parseEther("0.1") / TokenScale);
          const collateralBefore = await collateralToken.balanceOf(deployer.address);
          const treasuryBefore = await collateralToken.balanceOf(treasury.getAddress());
          const revenuePoolBefore = await collateralToken.balanceOf(revenuePool.getAddress());
          const splitterBefore = await collateralToken.balanceOf(rewarder.getAddress());
          const [, poolCollateralBefore, , , poolDebtBefore] = await poolManager.getPoolInfo(pool.getAddress());
          await poolManager.connect(deployer).harvest(pool.getAddress());
          const collateralAfter = await collateralToken.balanceOf(deployer.address);
          const treasuryAfter = await collateralToken.balanceOf(treasury.getAddress());
          const revenuePoolAfter = await collateralToken.balanceOf(revenuePool.getAddress());
          const splitterAfter = await collateralToken.balanceOf(rewarder.getAddress());
          const [, poolCollateralAfter, , , poolDebtAfter] = await poolManager.getPoolInfo(pool.getAddress());
          expect(await poolManager.accumulatedPoolOpenFees(pool.getAddress())).to.eq(0n);
          expect(poolDebtBefore).to.eq(poolDebtAfter);
          expect(poolCollateralBefore - poolCollateralAfter).to.eq(rewards);
          expect(collateralAfter - collateralBefore).to.eq(rewards / 100n);
          expect(treasuryAfter - treasuryBefore).to.eq(rewards / 10n);
          expect(splitterAfter - splitterBefore).to.eq(rewards - rewards / 10n - rewards / 100n);
          expect(revenuePoolAfter - revenuePoolBefore).to.eq(accumulatedPoolFees);
          expect((await poolManager.getPoolInfo(pool.getAddress())).rawCollateral).to.eq(
            await pool.getTotalRawCollaterals()
          );

          // take fee, nothing happened
          const before = await collateralToken.balanceOf(revenuePool.address);
          await poolManager.withdrawAccumulatedPoolFee([pool.getAddress()]);
          const after = await collateralToken.balanceOf(revenuePool.address);
          expect(after - before).to.eq(0n);
          expect(await poolManager.accumulatedPoolOpenFees(pool.getAddress())).to.eq(0n);

          // harvest again, nothing happened
          const tx = await poolManager.connect(deployer).harvest(pool.getAddress());
          const r = await tx.wait();
          expect(r?.logs.length).to.eq(1); // only harvest event
        });
      });
    });
  };

  runTests(18n);
  runTests(8n);
});
