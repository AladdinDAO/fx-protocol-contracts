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
  MockStakedFxUSD,
  PegKeeper,
  PegKeeper__factory,
  PoolManager,
  PoolManager__factory,
  ProxyAdmin,
  ReservePool,
  SfxUSDRewarder,
} from "@/types/index";
import { encodeChainlinkPriceFeed } from "@/utils/index";

const TokenRate = ethers.parseEther("1.23");

describe("PoolManager.spec", async () => {
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
  let sfxUSD: MockStakedFxUSD;
  let sfxUSDRewarder: SfxUSDRewarder;

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
        const MockStakedFxUSD = await ethers.getContractFactory("MockStakedFxUSD", deployer);
        const ReservePool = await ethers.getContractFactory("ReservePool", deployer);
        const SfxUSDRewarder = await ethers.getContractFactory("SfxUSDRewarder", deployer);
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

        // deploy StakedFxUSD
        const StakedFxUSDImpl = await MockStakedFxUSD.deploy(
          PoolManagerProxy.getAddress(),
          PegKeeperProxy.getAddress(),
          FxUSDRegeneracyProxy.getAddress(),
          stableToken.getAddress(),
          encodeChainlinkPriceFeed(await mockAggregatorV3Interface.getAddress(), 10n ** 10n, 1000000000)
        );
        await proxyAdmin.upgrade(StakedFxUSDProxy.getAddress(), StakedFxUSDImpl.getAddress());
        sfxUSD = await ethers.getContractAt("MockStakedFxUSD", await StakedFxUSDProxy.getAddress(), admin);

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

        sfxUSDRewarder = await SfxUSDRewarder.deploy(sfxUSD.getAddress());
        await poolManager.registerPool(
          pool.getAddress(),
          sfxUSDRewarder.getAddress(),
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
          expect(await poolManager.sfxUSD()).to.eq(await sfxUSD.getAddress());
          expect(await poolManager.pegKeeper()).to.eq(await pegKeeper.getAddress());

          expect(await poolManager.platform()).to.eq(platform.address);
          expect(await poolManager.reservePool()).to.eq(await reservePool.getAddress());
          expect(await poolManager.getExpenseRatio()).to.eq(ethers.parseUnits("0.1", 9));
          expect(await poolManager.getHarvesterRatio()).to.eq(ethers.parseUnits("0.01", 9));
          expect(await poolManager.getRebalancePoolRatio()).to.eq(ethers.parseUnits("0.89", 9));
          expect(await poolManager.getFlashLoanFeeRatio()).to.eq(ethers.parseUnits("0.0001", 9));
          expect(await poolManager.getRedeemFeeRatio()).to.eq(0n);
        });

        it("should revert, when initialize again", async () => {
          await expect(
            poolManager.initialize(ZeroAddress, 0n, 0n, 0n, ZeroAddress, ZeroAddress)
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

        context("#updatePlatform", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updatePlatform(ZeroAddress))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorZeroAddress", async () => {
            await expect(poolManager.connect(admin).updatePlatform(ZeroAddress)).to.revertedWithCustomError(
              pool,
              "ErrorZeroAddress"
            );
          });

          it("should succeed", async () => {
            expect(await poolManager.platform()).to.eq(await platform.getAddress());
            await expect(poolManager.connect(admin).updatePlatform(deployer.address))
              .to.emit(poolManager, "UpdatePlatform")
              .withArgs(await platform.getAddress(), deployer.address);
            expect(await poolManager.platform()).to.eq(deployer.address);
          });
        });

        context("#updateExpenseRatio", async () => {
          it("should revert, when caller is not admin", async () => {
            await expect(poolManager.connect(deployer).updateExpenseRatio(0))
              .to.revertedWithCustomError(poolManager, "AccessControlUnauthorizedAccount")
              .withArgs(deployer.address, ZeroHash);
          });

          it("should revert, when ErrorExpenseRatioTooLarge", async () => {
            await expect(poolManager.connect(admin).updateExpenseRatio(500000000n + 1n)).to.revertedWithCustomError(
              poolManager,
              "ErrorExpenseRatioTooLarge"
            );
          });

          it("should succeed", async () => {
            expect(await poolManager.getExpenseRatio()).to.eq(ethers.parseUnits("0.1", 9));
            await expect(poolManager.connect(admin).updateExpenseRatio(500000000n))
              .to.emit(poolManager, "UpdateExpenseRatio")
              .withArgs(ethers.parseUnits("0.1", 9), 500000000n);
            expect(await poolManager.getExpenseRatio()).to.eq(500000000n);
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

            await expect(
              poolManager.connect(admin).registerPool(newPool.getAddress(), sfxUSDRewarder.getAddress(), 1n, 2n)
            )
              .to.emit(poolManager, "RegisterPool")
              .withArgs(await newPool.getAddress())
              .to.emit(poolManager, "UpdatePoolCapacity")
              .withArgs(await newPool.getAddress(), 1n, 2n)
              .to.emit(poolManager, "UpdateRewardSplitter")
              .withArgs(await newPool.getAddress(), ZeroAddress, await sfxUSDRewarder.getAddress());
            expect(await poolManager.getPoolInfo(await newPool.getAddress())).to.deep.eq([1n, 0n, 2n, 0n]);
          });

          it("should succeed when register again", async () => {
            await expect(
              poolManager.connect(admin).registerPool(pool.getAddress(), sfxUSDRewarder.getAddress(), 1n, 2n)
            )
              .to.not.emit(poolManager, "RegisterPool")
              .to.not.emit(poolManager, "UpdatePoolCapacity")
              .to.not.emit(poolManager, "UpdateRewardSplitter");
            expect(await poolManager.getPoolInfo(await pool.getAddress())).to.deep.eq([
              ethers.parseUnits("10000", tokenDecimals),
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
              .withArgs(await pool.getAddress(), await sfxUSDRewarder.getAddress(), ZeroAddress);
            expect(await poolManager.rewardSplitter(pool.getAddress())).to.eq(ZeroAddress);
            await expect(
              poolManager.connect(admin).updateRewardSplitter(pool.getAddress(), sfxUSDRewarder.getAddress())
            )
              .to.emit(poolManager, "UpdateRewardSplitter")
              .withArgs(await pool.getAddress(), ZeroAddress, await sfxUSDRewarder.getAddress());
            expect(await poolManager.rewardSplitter(pool.getAddress())).to.eq(await sfxUSDRewarder.getAddress());
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
              ethers.parseEther("10000000"),
              0n,
            ]);
            await expect(poolManager.connect(admin).updatePoolCapacity(pool.getAddress(), 1n, 2n))
              .to.emit(poolManager, "UpdatePoolCapacity")
              .withArgs(await pool.getAddress(), 1n, 2n);
            expect(await poolManager.getPoolInfo(await pool.getAddress())).to.deep.eq([1n, 0n, 2n, 0n]);
          });
        });
      });

      context("operate", async () => {
        beforeEach(async () => {
          await collateralToken.mint(deployer.address, ethers.parseEther("10000"));
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

          expect(await poolManager.accumulatedPoolFees(pool.getAddress())).to.eq(newRawColl / 1000n);
          expect((await poolManager.getPoolInfo(pool.getAddress())).collateralBalance).to.eq(newRawColl - protocolFees);
          expect((await poolManager.getPoolInfo(pool.getAddress())).debtBalance).to.eq(newRawDebt);
          expect(await pool.ownerOf(1)).to.eq(deployer.address);
          expect(await pool.getPosition(1)).to.deep.eq([
            ((newRawColl - protocolFees) * TokenRate) / 10n ** 18n,
            newRawDebt,
          ]);
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

            expect(await poolManager.accumulatedPoolFees(pool.getAddress())).to.eq(InitialProtocolFees + protocolFees);
            expect((await poolManager.getPoolInfo(pool.getAddress())).collateralBalance).to.eq(
              InitialRawCollateral - InitialProtocolFees + rawColl - protocolFees
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

            expect(await poolManager.accumulatedPoolFees(pool.getAddress())).to.eq(InitialProtocolFees + protocolFees);
            expect((await poolManager.getPoolInfo(pool.getAddress())).collateralBalance).to.eq(
              InitialRawCollateral - InitialProtocolFees - rawColl
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
            expect((await poolManager.getPoolInfo(pool.getAddress())).debtBalance).to.eq(InitialRawDebt);
          });
        });
      });

      /*
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
          await expect(pool.connect(deployer).redeem(0)).to.revertedWithCustomError(poolManager, "ErrorCallerNotPoolManager");
        });

        it("should revert, when redeem paused", async () => {
          await pool.updateBorrowAndRedeemStatus(true, true);
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
          await pool
            .connect(signer)
            .operate(0, ethers.parseEther("12.3"), ethers.parseEther("22000"), deployer.address);
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

        it("should ok", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 2000, debt ratio became 0.894308943089430894
          await mockPriceOracle.setPrices(
            ethers.parseEther("2000"),
            ethers.parseEther("2000"),
            ethers.parseEther("2000")
          );

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
          expect((await pool.getPosition(1)).rawDebts).to.closeTo(
            ethers.parseEther("184.081632653061224305"),
            1000000n
          );
          expect((await pool.getPosition(2)).rawColls).to.closeTo(ethers.parseEther("1.045918367346938774"), 10n);
          expect((await pool.getPosition(2)).rawDebts).to.closeTo(
            ethers.parseEther("1840.816326530612243057"),
            1000000n
          );
          expect((await pool.getPosition(3)).rawColls).to.closeTo(ethers.parseEther("10.459183673469387745"), 10n);
          expect((await pool.getPosition(3)).rawDebts).to.closeTo(
            ethers.parseEther("18408.163265306122430572"),
            1000000n
          );
        });
      });

      context("rebalance on position", async () => {
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
          await pool
            .connect(signer)
            .operate(0, ethers.parseEther("12.3"), ethers.parseEther("22000"), deployer.address);
          expect(await pool.getNextTreeNodeId()).to.eq(2);
          expect(await pool.getTopTick()).to.eq(4997);
        });

        it("should revert, when ErrorCallerNotPoolManager", async () => {
          await expect(pool.connect(deployer)["rebalance(uint32,uint256)"](0, 0)).to.revertedWithCustomError(
            pool,
            "ErrorCallerNotPoolManager"
          );
        });

        it("should revert, when ErrorRebalanceDebtRatioNotReached", async () => {
          await expect(pool.connect(signer)["rebalance(uint32,uint256)"](1, MaxUint256)).to.revertedWithCustomError(
            pool,
            "ErrorRebalanceDebtRatioNotReached"
          );
        });

        it("should ok", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 2000, debt ratio became 0.894308943089430894
          await mockPriceOracle.setPrices(
            ethers.parseEther("2000"),
            ethers.parseEther("2000"),
            ethers.parseEther("2000")
          );

          // rebalance position 1 to 0.88
          await pool.connect(signer)["rebalance(uint32,uint256)"](1, MaxUint256);
          expect((await pool.getPosition(1)).rawColls).to.closeTo(ethers.parseEther("0.104591836734693877"), 1000000n);
          expect((await pool.getPosition(1)).rawDebts).to.closeTo(
            ethers.parseEther("184.081632653061224305"),
            1000000n
          );
          expect(
            ((await pool.getPosition(1)).rawDebts * 10n ** 18n) / ((await pool.getPosition(1)).rawColls * 2000n)
          ).to.closeTo(ethers.parseEther("0.88"), 1000000n);
          expect(await pool.getTopTick()).to.eq(4997);
          // rebalance position 2 to 0.88
          await pool.connect(signer)["rebalance(uint32,uint256)"](2, MaxUint256);
          expect((await pool.getPosition(2)).rawColls).to.closeTo(ethers.parseEther("1.045918367346938774"), 1000000n);
          expect((await pool.getPosition(2)).rawDebts).to.closeTo(
            ethers.parseEther("1840.816326530612243057"),
            1000000n
          );
          expect(
            ((await pool.getPosition(2)).rawDebts * 10n ** 18n) / ((await pool.getPosition(2)).rawColls * 2000n)
          ).to.closeTo(ethers.parseEther("0.88"), 1000000n);
          expect(await pool.getTopTick()).to.eq(4997);
          // rebalance position 3 to 0.88
          await pool.connect(signer)["rebalance(uint32,uint256)"](3, MaxUint256);
          expect((await pool.getPosition(3)).rawColls).to.closeTo(ethers.parseEther("10.459183673469387745"), 1000000n);
          expect((await pool.getPosition(3)).rawDebts).to.closeTo(
            ethers.parseEther("18408.163265306122430572"),
            1000000n
          );
          expect(
            ((await pool.getPosition(3)).rawDebts * 10n ** 18n) / ((await pool.getPosition(3)).rawColls * 2000n)
          ).to.closeTo(ethers.parseEther("0.88"), 1000000n);
          expect(await pool.getTopTick()).to.eq(4986);

          // check final states
          expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("11.609693877551020409"), 1000000n);
          expect(await pool.getTotalRawDebts()).to.closeTo(ethers.parseEther("20433.061224489795918368"), 1000000n);
          expect(
            ((await pool.getTotalRawDebts()) * 10n ** 18n) / ((await pool.getTotalRawCollaterals()) * 2000n)
          ).to.closeTo(ethers.parseEther("0.88"), 1000000n);
        });
      });

      context("liquidate on position", async () => {
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
          await pool
            .connect(signer)
            .operate(0, ethers.parseEther("12.3"), ethers.parseEther("22000"), deployer.address);
          expect(await pool.getNextTreeNodeId()).to.eq(2);
          expect(await pool.getTopTick()).to.eq(4997);
        });

        it("should revert, when ErrorCallerNotPoolManager", async () => {
          await expect(pool.connect(deployer).liquidate(0, 0, 0)).to.revertedWithCustomError(
            pool,
            "ErrorCallerNotPoolManager"
          );
        });

        it("should revert, when ErrorLiquidateDebtRatioNotReached", async () => {
          await expect(pool.connect(signer).liquidate(1, MaxUint256, MaxUint256)).to.revertedWithCustomError(
            pool,
            "ErrorLiquidateDebtRatioNotReached"
          );
        });

        it("should ok, when collateral can cover bonus", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 1900, debt ratio became 0.941377834830979888
          await mockPriceOracle.setPrices(
            ethers.parseEther("1900"),
            ethers.parseEther("1900"),
            ethers.parseEther("1900")
          );

          // liquidate position 1
          let [rawColls, rawDebts, bonusRawColls, bonusFromReserve] = await pool
            .connect(signer)
            .liquidate.staticCall(1, MaxUint256, MaxUint256);
          expect(rawColls).to.closeTo(ethers.parseEther("0.115789473684210526"), 1000000n);
          expect(rawDebts).to.eq(ethers.parseEther("220"));
          expect(bonusRawColls).to.closeTo((rawColls * 5n) / 100n, 1000000n);
          expect(bonusFromReserve).to.eq(0n);
          await pool.connect(signer).liquidate(1, MaxUint256, MaxUint256);
          expect((await pool.getPosition(1)).rawColls).to.closeTo(ethers.parseEther("0.001421052631578948"), 1000000n);
          expect((await pool.getPosition(1)).rawDebts).to.eq(0n);

          // partial liquidate position 2
          [rawColls, rawDebts, bonusRawColls, bonusFromReserve] = await pool
            .connect(signer)
            .liquidate.staticCall(2, ethers.parseEther("1000"), MaxUint256);
          expect(rawColls).to.closeTo(ethers.parseEther("0.526315789473684210"), 1000000n);
          expect(rawDebts).to.eq(ethers.parseEther("1000"));
          expect(bonusRawColls).to.closeTo((rawColls * 5n) / 100n, 1000000n);
          expect(bonusFromReserve).to.eq(0n);
          await pool.connect(signer).liquidate(2, ethers.parseEther("1000"), MaxUint256);
          expect((await pool.getPosition(2)).rawColls).to.closeTo(ethers.parseEther("0.677368421052631580"), 1000000n);
          expect((await pool.getPosition(2)).rawDebts).to.eq(ethers.parseEther("1200"));

          expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("12.978789473684210528"), 1000000n);
          expect(await pool.getTotalRawDebts()).to.closeTo(ethers.parseEther("23200"), 1000000n);
        });

        it("should ok, when collateral + reserve can cover bonus", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 1850, debt ratio became 0.966820479015600966
          await mockPriceOracle.setPrices(
            ethers.parseEther("1850"),
            ethers.parseEther("1850"),
            ethers.parseEther("1850")
          );

          // liquidate position 1
          let [rawColls, rawDebts, bonusRawColls, bonusFromReserve] = await pool
            .connect(signer)
            .liquidate.staticCall(1, MaxUint256, MaxUint256);
          expect(rawColls).to.closeTo(ethers.parseEther("0.118918918918918918"), 1000000n);
          expect(rawDebts).to.eq(ethers.parseEther("220"));
          expect(bonusRawColls).to.closeTo((rawColls * 5n) / 100n, 1000000n);
          expect(bonusFromReserve).to.closeTo(ethers.parseEther("0.001864864864864863"), 1000000n);
          await pool.connect(signer).liquidate(1, MaxUint256, MaxUint256);
          expect((await pool.getPosition(1)).rawColls).to.eq(0n);
          expect((await pool.getPosition(1)).rawDebts).to.eq(0n);

          expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("13.53"), 1000000n);
          expect(await pool.getTotalRawDebts()).to.closeTo(ethers.parseEther("24200"), 1000000n);
        });

        it("should ok, when collateral + reserve cannot cover bonus", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 1850, debt ratio became 0.966820479015600966
          await mockPriceOracle.setPrices(
            ethers.parseEther("1850"),
            ethers.parseEther("1850"),
            ethers.parseEther("1850")
          );

          // liquidate position 1
          let [rawColls, rawDebts, bonusRawColls, bonusFromReserve] = await pool
            .connect(signer)
            .liquidate.staticCall(1, MaxUint256, ethers.parseEther("0.001"));
          expect(rawColls).to.closeTo(ethers.parseEther("0.118918918918918918"), 1000000n);
          expect(rawDebts).to.eq(ethers.parseEther("220"));
          expect(bonusRawColls).to.closeTo(ethers.parseEther(".005081081081081082"), 1000000n);
          expect(bonusFromReserve).to.closeTo(ethers.parseEther("0.001"), 1000000n);
          await pool.connect(signer).liquidate(1, MaxUint256, ethers.parseEther("0.001"));
          expect((await pool.getPosition(1)).rawColls).to.eq(0n);
          expect((await pool.getPosition(1)).rawDebts).to.eq(0n);

          expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("13.53"), 1000000n);
          expect(await pool.getTotalRawDebts()).to.closeTo(ethers.parseEther("24200"), 1000000n);
        });

        it("should ok, when distribute bad debts", async () => {
          // current debt ratio is 0.596404763647503097 for min price = 2999
          // min price drop to 1700, debt ratio became 1.052128168340506934
          await mockPriceOracle.setPrices(
            ethers.parseEther("1700"),
            ethers.parseEther("1700"),
            ethers.parseEther("1700")
          );

          // liquidate position 1, and bad debt distribute to position 2 and 3
          let [rawColls, rawDebts, bonusRawColls, bonusFromReserve] = await pool
            .connect(signer)
            .liquidate.staticCall(1, ethers.parseEther("209"), 0n);
          expect(rawColls).to.closeTo(ethers.parseEther("0.122941176470588235"), 1000000n);
          expect(rawDebts).to.eq(ethers.parseEther("209"));
          expect(bonusRawColls).to.closeTo(ethers.parseEther("0.000058823529411765"), 1000000n);
          expect(bonusFromReserve).to.eq(0n);
          expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([2n ** 96n, 2n ** 96n]);
          await pool.connect(signer).liquidate(1, ethers.parseEther("209"), 0n);
          expect(await pool.getDebtAndCollateralIndex()).to.deep.eq([79264175315407185019722833949n, 2n ** 96n]);
          expect(await pool.getTotalRawCollaterals()).to.closeTo(ethers.parseEther("13.53"), 1000000n);
          expect(await pool.getTotalRawDebts()).to.closeTo(ethers.parseEther("24211"), 1000000n);
          expect((await pool.getPosition(1)).rawColls).to.eq(0n);
          expect((await pool.getPosition(1)).rawDebts).to.eq(0n);
          expect((await pool.getPosition(2)).rawColls).to.eq(ethers.parseEther("1.23"));
          expect((await pool.getPosition(2)).rawDebts).to.closeTo(ethers.parseEther("2201"), 1000000n);
          expect((await pool.getPosition(3)).rawColls).to.eq(ethers.parseEther("12.3"));
          expect((await pool.getPosition(3)).rawDebts).to.closeTo(ethers.parseEther("22010"), 1000000n);
        });
      });
      */
    });
  };

  runTests(18n);
});
