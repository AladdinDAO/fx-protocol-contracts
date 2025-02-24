import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";

import {
  FxUSDBasePool,
  ProxyAdmin,
  SavingFxUSD,
  RewardHarvester,
  SavingFxUSD__factory,
  MockERC20,
} from "@/types/index";

import { forkNetworkAndUnlockAccounts, mockETHBalance } from "@/test/utils";
import { id, ZeroAddress, ZeroHash } from "ethers";
import { EthereumTokens } from "@/utils/index";

const FORK_HEIGHT = 21802842;
const FORK_URL = process.env.MAINNET_FORK_RPC || "";
const PLATFORM = "0x0084C2e1B1823564e597Ff4848a88D61ac63D703";
const OWNER = "0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF";
const DEPLOYER = "0x1000000000000000000000000000000000000001";
const USDC_HOLDER = "0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341";
const fxUSD_HOLDER = "0xEC2eda1C4F981E468ABF62424a10B69B738b498E";
const fxBASE_HOLDER = "0x57d17a7fE8fc209A9Da4fdbeA0f8f09C1bAD7656";
const fxBASE_GAUGE_HOLDER = "0x0731E66A0beb417B7c16E15CCF7a4b363c2Abb4F";

describe("SavingFxUSD.spec", async () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;

  let proxyAdmin: ProxyAdmin;

  let gauge: MockERC20;
  let fxBASE: FxUSDBasePool;
  let fxSAVE: SavingFxUSD;
  let harvester: RewardHarvester;

  beforeEach(async () => {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [
      DEPLOYER,
      USDC_HOLDER,
      fxUSD_HOLDER,
      fxBASE_HOLDER,
      fxBASE_GAUGE_HOLDER,
      OWNER,
    ]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    await mockETHBalance(OWNER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);
    owner = await ethers.getSigner(OWNER);

    proxyAdmin = await ethers.getContractAt("ProxyAdmin", "0x9B54B7703551D9d0ced177A78367560a8B2eDDA4", owner);
    fxBASE = await ethers.getContractAt("FxUSDBasePool", "0x65C9A641afCEB9C0E6034e558A319488FA0FA3be", owner);
    gauge = await ethers.getContractAt("MockERC20", "0xEd92dDe3214c24Ae04F5f96927E3bE8f8DbC3289", owner);

    const EmptyContract = await ethers.getContractFactory("EmptyContract", deployer);
    const TransparentUpgradeableProxy = await ethers.getContractFactory("TransparentUpgradeableProxy", deployer);
    const SavingFxUSD = await ethers.getContractFactory("SavingFxUSD", deployer);
    const RewardHarvester = await ethers.getContractFactory("RewardHarvester", deployer);

    const empty = await EmptyContract.deploy();
    const SavingFxUSDProxy = await TransparentUpgradeableProxy.deploy(
      empty.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );
    const SavingFxUSDImpl = await SavingFxUSD.deploy(fxBASE.getAddress(), gauge.getAddress());

    harvester = await RewardHarvester.deploy(SavingFxUSDProxy.getAddress());
    await proxyAdmin.upgradeAndCall(
      SavingFxUSDProxy.getAddress(),
      SavingFxUSDImpl.getAddress(),
      SavingFxUSD__factory.createInterface().encodeFunctionData("initialize", [
        owner.address,
        {
          name: "Saving f(x) USD",
          symbol: "fxSAVE",
          pid: 36,
          threshold: ethers.parseEther("100"),
          treasury: PLATFORM,
          harvester: await harvester.getAddress(),
        },
      ])
    );
    fxSAVE = await ethers.getContractAt("SavingFxUSD", await SavingFxUSDProxy.getAddress());
  });

  context("constructor", async () => {
    it("should initialize correctly", async () => {
      // ERC20
      expect(await fxSAVE.name()).to.eq("Saving f(x) USD");
      expect(await fxSAVE.symbol()).to.eq("fxSAVE");
      expect(await fxSAVE.decimals()).to.eq(18);
      expect(await fxSAVE.totalSupply()).to.eq(0);

      // ERC4626
      expect(await fxSAVE.asset()).to.eq(await fxBASE.getAddress());
      expect(await fxSAVE.totalAssets()).to.eq(0n);
      expect(await fxSAVE.convertToShares(ethers.parseEther("1"))).to.eq(ethers.parseEther("1"));
      expect(await fxSAVE.convertToAssets(ethers.parseEther("1"))).to.eq(ethers.parseEther("1"));

      // ConcentratorBase
      expect(await fxSAVE.treasury()).to.eq(PLATFORM);
      expect(await fxSAVE.harvester()).to.eq(await harvester.getAddress());
      expect(await fxSAVE.getExpenseRatio()).to.eq(0n);
      expect(await fxSAVE.getHarvesterRatio()).to.eq(0n);

      // SavingFxUSD
      expect(await fxSAVE.base()).to.eq(await fxBASE.getAddress());
      expect(await fxSAVE.gauge()).to.eq(await gauge.getAddress());
      expect(await fxSAVE.getThreshold()).to.eq(ethers.parseEther("100"));
      expect(await fxSAVE.nav()).to.eq(await fxBASE.nav());
    });

    it("should revert, when initialize again", async () => {
      await expect(
        fxSAVE.initialize(ZeroAddress, {
          name: "Saving f(x) USD",
          symbol: "fxSAVE",
          pid: 36,
          threshold: ethers.parseEther("100"),
          treasury: PLATFORM,
          harvester: await harvester.getAddress(),
        })
      ).to.revertedWithCustomError(fxSAVE, "InvalidInitialization");
    });
  });

  context("auth", async () => {
    context("#updateTreasury", async () => {
      it("should revert, when non-admin call", async () => {
        await expect(fxSAVE.connect(deployer).updateTreasury(ZeroAddress))
          .to.revertedWithCustomError(fxSAVE, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should revert, when treasury is zero", async () => {
        await expect(fxSAVE.connect(owner).updateTreasury(ZeroAddress)).to.revertedWithCustomError(
          fxSAVE,
          "ErrorZeroAddress"
        );
      });

      it("should succeed", async () => {
        expect(await fxSAVE.treasury()).to.eq(PLATFORM);
        await expect(fxSAVE.connect(owner).updateTreasury(deployer.address))
          .to.emit(fxSAVE, "UpdateTreasury")
          .withArgs(PLATFORM, deployer.address);
        expect(await fxSAVE.treasury()).to.eq(deployer.address);
      });
    });

    context("#updateHarvester", async () => {
      it("should revert, when non-admin call", async () => {
        await expect(fxSAVE.connect(deployer).updateHarvester(ZeroAddress))
          .to.revertedWithCustomError(fxSAVE, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed", async () => {
        expect(await fxSAVE.harvester()).to.eq(await harvester.getAddress());
        await expect(fxSAVE.connect(owner).updateHarvester(deployer.address))
          .to.emit(fxSAVE, "UpdateHarvester")
          .withArgs(await harvester.getAddress(), deployer.address);
        expect(await fxSAVE.harvester()).to.eq(deployer.address);
      });
    });

    context("#updateExpenseRatio", async () => {
      it("should revert, when non-admin call", async () => {
        await expect(fxSAVE.connect(deployer).updateExpenseRatio(0n))
          .to.revertedWithCustomError(fxSAVE, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should revert, when expense ratio too large", async () => {
        await expect(fxSAVE.connect(owner).updateExpenseRatio(5e8 + 1)).to.revertedWithCustomError(
          fxSAVE,
          "ErrorExpenseRatioTooLarge"
        );
      });

      it("should succeed", async () => {
        expect(await fxSAVE.getExpenseRatio()).to.eq(0n);
        await expect(fxSAVE.connect(owner).updateExpenseRatio(1n))
          .to.emit(fxSAVE, "UpdateExpenseRatio")
          .withArgs(0n, 1n);
        expect(await fxSAVE.getExpenseRatio()).to.eq(1n);
        await expect(fxSAVE.connect(owner).updateExpenseRatio(100n))
          .to.emit(fxSAVE, "UpdateExpenseRatio")
          .withArgs(1n, 100n);
        expect(await fxSAVE.getExpenseRatio()).to.eq(100n);
        await expect(fxSAVE.connect(owner).updateExpenseRatio(1e8))
          .to.emit(fxSAVE, "UpdateExpenseRatio")
          .withArgs(100n, 1e8);
        expect(await fxSAVE.getExpenseRatio()).to.eq(1e8);
        await expect(fxSAVE.connect(owner).updateExpenseRatio(5e8))
          .to.emit(fxSAVE, "UpdateExpenseRatio")
          .withArgs(1e8, 5e8);
        expect(await fxSAVE.getExpenseRatio()).to.eq(5e8);
      });
    });

    context("#updateHarvesterRatio", async () => {
      it("should revert, when non-admin call", async () => {
        await expect(fxSAVE.connect(deployer).updateHarvesterRatio(0n))
          .to.revertedWithCustomError(fxSAVE, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should revert, when harvester ratio too large", async () => {
        await expect(fxSAVE.connect(owner).updateHarvesterRatio(1e8 + 1)).to.revertedWithCustomError(
          fxSAVE,
          "ErrorHarvesterRatioTooLarge"
        );
      });

      it("should succeed", async () => {
        expect(await fxSAVE.getHarvesterRatio()).to.eq(0n);
        await expect(fxSAVE.connect(owner).updateHarvesterRatio(1n))
          .to.emit(fxSAVE, "UpdateHarvesterRatio")
          .withArgs(0n, 1n);
        expect(await fxSAVE.getHarvesterRatio()).to.eq(1n);
        await expect(fxSAVE.connect(owner).updateHarvesterRatio(100n))
          .to.emit(fxSAVE, "UpdateHarvesterRatio")
          .withArgs(1n, 100n);
        expect(await fxSAVE.getHarvesterRatio()).to.eq(100n);
        await expect(fxSAVE.connect(owner).updateHarvesterRatio(1e7))
          .to.emit(fxSAVE, "UpdateHarvesterRatio")
          .withArgs(100n, 1e7);
        expect(await fxSAVE.getHarvesterRatio()).to.eq(1e7);
        await expect(fxSAVE.connect(owner).updateHarvesterRatio(1e8))
          .to.emit(fxSAVE, "UpdateHarvesterRatio")
          .withArgs(1e7, 1e8);
        expect(await fxSAVE.getHarvesterRatio()).to.eq(1e8);
      });
    });

    context("#updateThreshold", async () => {
      it("should revert, when non-admin call", async () => {
        await expect(fxSAVE.connect(deployer).updateThreshold(0n))
          .to.revertedWithCustomError(fxSAVE, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should revert, when harvester ratio too large", async () => {
        await expect(fxSAVE.connect(owner).updateThreshold(1n << 80n)).to.revertedWithCustomError(
          fxSAVE,
          "ErrorThresholdTooLarge"
        );
      });

      it("should succeed", async () => {
        expect(await fxSAVE.getThreshold()).to.eq(ethers.parseEther("100"));
        await expect(fxSAVE.connect(owner).updateThreshold(1n))
          .to.emit(fxSAVE, "UpdateThreshold")
          .withArgs(ethers.parseEther("100"), 1n);
        expect(await fxSAVE.getThreshold()).to.eq(1n);
        await expect(fxSAVE.connect(owner).updateThreshold(100n)).to.emit(fxSAVE, "UpdateThreshold").withArgs(1n, 100n);
        expect(await fxSAVE.getThreshold()).to.eq(100n);
        await expect(fxSAVE.connect(owner).updateThreshold(1e8)).to.emit(fxSAVE, "UpdateThreshold").withArgs(100n, 1e8);
        expect(await fxSAVE.getThreshold()).to.eq(1e8);
        await expect(fxSAVE.connect(owner).updateThreshold((1n << 80n) - 1n))
          .to.emit(fxSAVE, "UpdateThreshold")
          .withArgs(1e8, (1n << 80n) - 1n);
        expect(await fxSAVE.getThreshold()).to.eq((1n << 80n) - 1n);
      });
    });
  });

  context("deposit", async () => {
    let signer: HardhatEthersSigner;

    beforeEach(async () => {
      signer = await ethers.getSigner(fxBASE_HOLDER);
      await mockETHBalance(signer.address, ethers.parseEther("100"));
    });

    it("should succeed, when deposit once", async () => {
      await fxBASE.connect(signer).approve(fxSAVE.getAddress(), ethers.parseEther("10"));
      await fxSAVE.connect(signer).deposit(ethers.parseEther("10"), signer.address);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("10"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("10"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("10"));
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("10"));
    });

    it("should succeed, when deposit multiple times", async () => {
      // first time, below threshold
      await fxBASE.connect(signer).approve(fxSAVE.getAddress(), ethers.parseEther("10"));
      await fxSAVE.connect(signer).deposit(ethers.parseEther("10"), signer.address);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("10"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("10"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("10"));
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("10"));

      // second time, equals to threshold
      await fxBASE.connect(signer).approve(fxSAVE.getAddress(), ethers.parseEther("90"));
      await fxSAVE.connect(signer).deposit(ethers.parseEther("90"), signer.address);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("100"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("100"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("100"));
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("0"));
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.eq(ethers.parseEther("100"));

      // harvest
      await fxSAVE.connect(owner).updateHarvester(signer.address);
      await fxBASE.connect(signer).transfer(fxSAVE.getAddress(), ethers.parseEther("1"));
      await fxSAVE.connect(signer).onHarvest(fxBASE.getAddress(), ethers.parseEther("1"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("100"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("101"));

      // second time, greater than threshold
      await fxBASE.connect(signer).approve(fxSAVE.getAddress(), ethers.parseEther("102"));
      await fxSAVE.connect(signer).deposit(ethers.parseEther("102"), signer.address);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("200.990099009900990099"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("200.990099009900990099"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("203"));
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("0"));
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.eq(ethers.parseEther("203"));
    });
  });

  context("depositGauge", async () => {
    let signer: HardhatEthersSigner;

    beforeEach(async () => {
      signer = await ethers.getSigner(fxBASE_GAUGE_HOLDER);
      await mockETHBalance(signer.address, ethers.parseEther("100"));
    });

    it("should succeed, when deposit once", async () => {
      await gauge.connect(signer).approve(fxSAVE.getAddress(), ethers.parseEther("10"));
      await fxSAVE.connect(signer).depositGauge(ethers.parseEther("10"), signer.address);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("10"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("10"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("10"));
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("0"));
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.eq(ethers.parseEther("10"));
    });

    it("should succeed, when deposit multiple times", async () => {
      // first time, below threshold
      await gauge.connect(signer).approve(fxSAVE.getAddress(), ethers.parseEther("10"));
      await fxSAVE.connect(signer).depositGauge(ethers.parseEther("10"), signer.address);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("10"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("10"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("10"));
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("0"));
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.eq(ethers.parseEther("10"));

      // second time, equals to threshold
      await gauge.connect(signer).approve(fxSAVE.getAddress(), ethers.parseEther("90"));
      await fxSAVE.connect(signer).depositGauge(ethers.parseEther("90"), signer.address);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("100"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("100"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("100"));
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("0"));
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.eq(ethers.parseEther("100"));

      // harvest
      await fxSAVE.connect(owner).updateHarvester(signer.address);
      await gauge.connect(signer).transfer(fxSAVE.getAddress(), ethers.parseEther("1"));
      await fxSAVE.connect(signer).onHarvest(gauge.getAddress(), ethers.parseEther("1"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("100"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("101"));

      // second time, greater than threshold
      await gauge.connect(signer).approve(fxSAVE.getAddress(), ethers.parseEther("102"));
      await fxSAVE.connect(signer).depositGauge(ethers.parseEther("102"), signer.address);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("200.990099009900990099"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("200.990099009900990099"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("203"));
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("0"));
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.eq(ethers.parseEther("203"));
    });
  });

  context("redeem", async () => {
    let signer: HardhatEthersSigner;

    beforeEach(async () => {
      signer = await ethers.getSigner(fxBASE_GAUGE_HOLDER);
      await mockETHBalance(signer.address, ethers.parseEther("100"));

      await gauge.connect(signer).approve(fxSAVE.getAddress(), ethers.parseEther("10000"));
      await fxSAVE.connect(signer).depositGauge(ethers.parseEther("10000"), signer.address);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("10000"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("10000"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("10000"));
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("0"));
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.eq(ethers.parseEther("10000"));

      // harvest
      await fxSAVE.connect(owner).updateHarvester(signer.address);
      await gauge.connect(signer).transfer(fxSAVE.getAddress(), ethers.parseEther("100"));
      await fxSAVE.connect(signer).onHarvest(gauge.getAddress(), ethers.parseEther("100"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("10000"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("10100"));
    });

    it("should succeed", async () => {
      await fxSAVE.connect(signer).redeem(ethers.parseEther("1"), deployer.address, signer.address);
      expect(await fxBASE.balanceOf(deployer.address)).to.closeTo(ethers.parseEther("1.01"), 1n);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("9999"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("9999"));
      expect(await fxSAVE.totalAssets()).to.closeTo(ethers.parseEther("10098.99"), 1n);
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("0"));
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.closeTo(ethers.parseEther("10098.99"), 1n);
    });
  });

  context("requestRedeem", async () => {
    let signer: HardhatEthersSigner;

    beforeEach(async () => {
      signer = await ethers.getSigner(fxBASE_GAUGE_HOLDER);
      await mockETHBalance(signer.address, ethers.parseEther("100"));

      await gauge.connect(signer).approve(fxSAVE.getAddress(), ethers.parseEther("10000"));
      await fxSAVE.connect(signer).depositGauge(ethers.parseEther("10000"), signer.address);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("10000"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("10000"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("10000"));
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("0"));
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.eq(ethers.parseEther("10000"));

      // harvest
      await fxSAVE.connect(owner).updateHarvester(signer.address);
      await gauge.connect(signer).transfer(fxSAVE.getAddress(), ethers.parseEther("100"));
      await fxSAVE.connect(signer).onHarvest(gauge.getAddress(), ethers.parseEther("100"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("10000"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("10100"));

      await fxSAVE.connect(signer).transfer(deployer.address, ethers.parseEther("100"));
    });

    it("should revert, when request more then balance", async () => {
      await expect(fxSAVE.connect(deployer).requestRedeem(ethers.parseEther("100") + 1n))
        .to.revertedWithCustomError(fxSAVE, "ERC4626ExceededMaxRedeem")
        .withArgs(deployer.address, ethers.parseEther("100") + 1n, ethers.parseEther("100"));
    });

    it("should succeed", async () => {
      await expect(fxSAVE.connect(deployer).requestRedeem(ethers.parseEther("100")))
        .to.emit(fxSAVE, "RequestRedeem")
        .withArgs(deployer.address, ethers.parseEther("100"), ethers.parseEther("100.999999999999999999"));
      const proxy = await fxSAVE.lockedProxy(deployer.address);
      expect(await fxSAVE.balanceOf(deployer.address)).to.eq(0n);
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("9900"));
      expect(await fxSAVE.totalAssets()).to.closeTo(ethers.parseEther("9999"), 1n);
      expect(await fxBASE.balanceOf(proxy)).to.closeTo(ethers.parseEther("101"), 1n);
    });
  });

  context("claim", async () => {
    let signer: HardhatEthersSigner;

    beforeEach(async () => {
      signer = await ethers.getSigner(fxBASE_GAUGE_HOLDER);
      await mockETHBalance(signer.address, ethers.parseEther("100"));

      await gauge.connect(signer).approve(fxSAVE.getAddress(), ethers.parseEther("10000"));
      await fxSAVE.connect(signer).depositGauge(ethers.parseEther("10000"), signer.address);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("10000"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("10000"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("10000"));
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("0"));
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.eq(ethers.parseEther("10000"));

      // harvest
      await fxSAVE.connect(owner).updateHarvester(signer.address);
      await gauge.connect(signer).transfer(fxSAVE.getAddress(), ethers.parseEther("100"));
      await fxSAVE.connect(signer).onHarvest(gauge.getAddress(), ethers.parseEther("100"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("10000"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("10100"));

      await fxSAVE.connect(signer).transfer(deployer.address, ethers.parseEther("100"));
      await expect(fxSAVE.connect(deployer).requestRedeem(ethers.parseEther("100")))
        .to.emit(fxSAVE, "RequestRedeem")
        .withArgs(deployer.address, ethers.parseEther("100"), ethers.parseEther("100.999999999999999999"));
    });

    context("claim", async () => {
      it("should succeed, when claim", async () => {
        const fxUSD = await ethers.getContractAt("MockERC20", EthereumTokens.fxUSD.address, deployer);
        const usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, deployer);

        const lastTimestamp = Number((await ethers.provider.getBlock("latest"))!.timestamp);
        await network.provider.send("evm_setNextBlockTimestamp", [lastTimestamp + 86400]);
        const proxy = await fxSAVE.lockedProxy(deployer.address);
        expect(await fxBASE.balanceOf(proxy)).to.gt(0n);
        const usdcBefore = await usdc.balanceOf(owner.address);
        const fxusdBefore = await fxUSD.balanceOf(owner.address);
        await fxSAVE.connect(deployer).claim(owner.address);
        const usdcAfter = await usdc.balanceOf(owner.address);
        const fxusdAfter = await fxUSD.balanceOf(owner.address);
        expect(usdcAfter).to.gt(usdcBefore);
        expect(fxusdAfter).to.gt(fxusdBefore);
        expect(await fxBASE.balanceOf(proxy)).to.eq(0n);
      });
    });

    context("claim for", async () => {
      it("should revert, when no CLAIM_FOR_ROLE role", async () => {
        await expect(fxSAVE.connect(signer).claimFor(deployer.address, signer.address))
          .to.revertedWithCustomError(fxSAVE, "AccessControlUnauthorizedAccount")
          .withArgs(signer.address, id("CLAIM_FOR_ROLE"));
      });

      it("should succeed, when claim for", async () => {
        const fxUSD = await ethers.getContractAt("MockERC20", EthereumTokens.fxUSD.address, deployer);
        const usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, deployer);
        await fxSAVE.connect(owner).grantRole(id("CLAIM_FOR_ROLE"), signer.address);

        const lastTimestamp = Number((await ethers.provider.getBlock("latest"))!.timestamp);
        await network.provider.send("evm_setNextBlockTimestamp", [lastTimestamp + 86400]);
        const proxy = await fxSAVE.lockedProxy(deployer.address);
        expect(await fxBASE.balanceOf(proxy)).to.gt(0n);
        const usdcBefore = await usdc.balanceOf(owner.address);
        const fxusdBefore = await fxUSD.balanceOf(owner.address);
        await fxSAVE.connect(signer).claimFor(deployer.address, owner.address);
        const usdcAfter = await usdc.balanceOf(owner.address);
        const fxusdAfter = await fxUSD.balanceOf(owner.address);
        expect(usdcAfter).to.gt(usdcBefore);
        expect(fxusdAfter).to.gt(fxusdBefore);
        expect(await fxBASE.balanceOf(proxy)).to.eq(0n);
      });
    });
  });

  context("harvest", async () => {
    let signer: HardhatEthersSigner;

    beforeEach(async () => {
      signer = await ethers.getSigner(fxBASE_GAUGE_HOLDER);
      await mockETHBalance(signer.address, ethers.parseEther("100"));

      await gauge.connect(signer).approve(fxSAVE.getAddress(), ethers.parseEther("10000"));
      await fxSAVE.connect(signer).depositGauge(ethers.parseEther("10000"), signer.address);
      expect(await fxSAVE.balanceOf(signer.address)).to.eq(ethers.parseEther("10000"));
      expect(await fxSAVE.totalSupply()).to.eq(ethers.parseEther("10000"));
      expect(await fxSAVE.totalAssets()).to.eq(ethers.parseEther("10000"));
      expect(await fxBASE.balanceOf(fxSAVE.getAddress())).to.eq(ethers.parseEther("0"));
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.eq(ethers.parseEther("10000"));

      await harvester.grantRole(id("PERMISSIONED_TRADER_ROLE"), deployer.address);
    });

    it("should succeed, when harvest fxBASE-gauge", async () => {
      await gauge.connect(signer).transfer(harvester.getAddress(), ethers.parseEther("100"));
      await harvester.swapAndDistribute(ethers.parseEther("100"), gauge.getAddress(), gauge.getAddress(), {
        router: ZeroAddress,
        data: "0x",
        minOut: 0n,
      });
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.eq(ethers.parseEther("10100"));
    });

    it("should succeed, when harvest fxBASE", async () => {
      const holder = await ethers.getSigner(fxBASE_HOLDER);
      await mockETHBalance(holder.address, ethers.parseEther("100"));
      await fxBASE.connect(holder).transfer(harvester.getAddress(), ethers.parseEther("100"));
      await harvester.swapAndDistribute(ethers.parseEther("100"), fxBASE.getAddress(), fxBASE.getAddress(), {
        router: ZeroAddress,
        data: "0x",
        minOut: 0n,
      });
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.eq(ethers.parseEther("10100"));
    });

    it("should succeed, when harvest USDC", async () => {
      const holder = await ethers.getSigner(USDC_HOLDER);
      const usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, holder);
      await mockETHBalance(holder.address, ethers.parseEther("100"));
      await usdc.connect(holder).transfer(harvester.getAddress(), ethers.parseUnits("100", 6));
      await harvester.swapAndDistribute(ethers.parseUnits("100", 6), usdc.getAddress(), usdc.getAddress(), {
        router: ZeroAddress,
        data: "0x",
        minOut: 0n,
      });
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.gt(ethers.parseEther("10000"));
    });

    it("should succeed, when harvest fxUSD", async () => {
      const holder = await ethers.getSigner(fxUSD_HOLDER);
      const fxusd = await ethers.getContractAt("MockERC20", EthereumTokens.fxUSD.address, holder);
      await mockETHBalance(holder.address, ethers.parseEther("100"));
      await fxusd.connect(holder).transfer(harvester.getAddress(), ethers.parseUnits("100", 18));
      await harvester.swapAndDistribute(ethers.parseEther("100"), fxusd.getAddress(), fxusd.getAddress(), {
        router: ZeroAddress,
        data: "0x",
        minOut: 0n,
      });
      expect(await gauge.balanceOf(await fxSAVE.vault())).to.gt(ethers.parseEther("10000"));
    });
  });
});
