import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { TokenSchedule, TokenMinter, BFXN, MockMultipleRewardDistributor } from "@/types/index";

describe("TokenSchedule.spec", async () => {
  let admin: HardhatEthersSigner;
  let distributor: HardhatEthersSigner;

  let tokenSchedule: TokenSchedule;
  let tokenMinter: TokenMinter;
  let governanceToken: BFXN;
  let mockGauge1: MockMultipleRewardDistributor;
  let mockGauge2: MockMultipleRewardDistributor;
  let mockGauge3: MockMultipleRewardDistributor;

  const INIT_SUPPLY = ethers.parseEther("122000000"); // 122M tokens
  const INIT_RATE = ethers.parseEther("0.247336377473363774"); // 0.247336377473363774 tokens per second
  const RATE_REDUCTION_COEFFICIENT = 1111111111111111111n; // 10/9 * 1e18

  beforeEach(async () => {
    [admin, distributor] = await ethers.getSigners();

    const ProxyAdmin = await ethers.getContractFactory("ProxyAdmin", admin);
    const TransparentUpgradeableProxy = await ethers.getContractFactory("TransparentUpgradeableProxy", admin);

    const proxyAdmin = await ProxyAdmin.deploy();
    const TokenMinterProxy = await TransparentUpgradeableProxy.deploy(
      proxyAdmin.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );
    const GovernanceTokenProxy = await TransparentUpgradeableProxy.deploy(
      proxyAdmin.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );
    const TokenScheduleProxy = await TransparentUpgradeableProxy.deploy(
      proxyAdmin.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );

    const GovernanceToken = await ethers.getContractFactory("bFXN", admin);
    const GovernanceTokenImplementation = await GovernanceToken.deploy(TokenMinterProxy.getAddress());
    await proxyAdmin.upgrade(GovernanceTokenProxy.getAddress(), GovernanceTokenImplementation.getAddress());

    const TokenMinter = await ethers.getContractFactory("TokenMinter", admin);
    const TokenMinterImplementation = await TokenMinter.deploy(GovernanceTokenProxy.getAddress());
    await proxyAdmin.upgrade(TokenMinterProxy.getAddress(), TokenMinterImplementation.getAddress());

    const TokenSchedule = await ethers.getContractFactory("TokenSchedule", admin);
    const TokenScheduleImplementation = await TokenSchedule.deploy(TokenMinterProxy.getAddress());
    await proxyAdmin.upgrade(TokenScheduleProxy.getAddress(), TokenScheduleImplementation.getAddress());

    governanceToken = (await ethers.getContractAt("bFXN", await GovernanceTokenProxy.getAddress())) as any as BFXN;
    tokenMinter = (await ethers.getContractAt(
      "TokenMinter",
      await TokenMinterProxy.getAddress()
    )) as any as TokenMinter;
    tokenSchedule = (await ethers.getContractAt(
      "TokenSchedule",
      await TokenScheduleProxy.getAddress()
    )) as any as TokenSchedule;

    await governanceToken.initialize("Governance Token", "GOV");
    await tokenMinter.initialize(INIT_SUPPLY, INIT_RATE, RATE_REDUCTION_COEFFICIENT);
    await tokenSchedule.initialize();

    const MockMultipleRewardDistributor = await ethers.getContractFactory("MockMultipleRewardDistributor", admin);
    mockGauge1 = await MockMultipleRewardDistributor.deploy();
    await mockGauge1.initialize();
    mockGauge2 = await MockMultipleRewardDistributor.deploy();
    await mockGauge2.initialize();
    mockGauge3 = await MockMultipleRewardDistributor.deploy();
    await mockGauge3.initialize();

    // Grant roles
    await tokenMinter.grantRole(await tokenMinter.MINTER_ROLE(), tokenSchedule.getAddress());
    await tokenSchedule.grantRole(await tokenSchedule.DISTRIBUTOR_ROLE(), distributor.address);
  });

  context("constructor", async () => {
    it("should initialize correctly", async () => {
      expect(await tokenSchedule.minter()).to.eq(await tokenMinter.getAddress());
      expect(await tokenSchedule.token()).to.eq(await governanceToken.getAddress());
      expect(await tokenSchedule.totalWeight()).to.eq(0n);
      expect(await tokenSchedule.lastDistributeTime()).to.eq(await tokenMinter.getStartEpochTime());
    });
  });

  context("updateGaugeWeight", async () => {
    it("should revert when caller is not admin", async () => {
      await expect(
        tokenSchedule.connect(distributor).updateGaugeWeight(await mockGauge1.getAddress(), ethers.parseEther("1"))
      )
        .to.revertedWithCustomError(tokenSchedule, "AccessControlUnauthorizedAccount")
        .withArgs(await distributor.getAddress(), await tokenSchedule.DEFAULT_ADMIN_ROLE());
    });

    it("should revert when weight not changed", async () => {
      await tokenSchedule.connect(admin).updateGaugeWeight(await mockGauge1.getAddress(), ethers.parseEther("1"));
      await expect(
        tokenSchedule.connect(admin).updateGaugeWeight(await mockGauge1.getAddress(), ethers.parseEther("1"))
      ).to.revertedWithCustomError(tokenSchedule, "ErrorGaugeWeightNotChanged");
    });

    it("should update gauge weight correctly", async () => {
      await expect(
        tokenSchedule.connect(admin).updateGaugeWeight(await mockGauge1.getAddress(), ethers.parseEther("1"))
      )
        .to.emit(tokenSchedule, "UpdateGaugeWeight")
        .withArgs(await mockGauge1.getAddress(), 0n, ethers.parseEther("1"));
      expect(await tokenSchedule.getWeight(await mockGauge1.getAddress())).to.eq(ethers.parseEther("1"));
      expect(await tokenSchedule.totalWeight()).to.eq(ethers.parseEther("1"));
      expect(await tokenSchedule.getNormalizedWeight(await mockGauge1.getAddress())).to.eq(ethers.parseEther("1"));
      expect(await tokenSchedule.getNormalizedWeight(await mockGauge2.getAddress())).to.eq(ethers.parseEther("0"));

      await expect(
        tokenSchedule.connect(admin).updateGaugeWeight(await mockGauge2.getAddress(), ethers.parseEther("2"))
      )
        .to.emit(tokenSchedule, "UpdateGaugeWeight")
        .withArgs(await mockGauge2.getAddress(), 0n, ethers.parseEther("2"));
      expect(await tokenSchedule.getWeight(await mockGauge2.getAddress())).to.eq(ethers.parseEther("2"));
      expect(await tokenSchedule.totalWeight()).to.eq(ethers.parseEther("3"));
      expect(await tokenSchedule.getNormalizedWeight(await mockGauge1.getAddress())).to.eq(
        ethers.parseEther("0.333333333333333333")
      );
      expect(await tokenSchedule.getNormalizedWeight(await mockGauge2.getAddress())).to.eq(
        ethers.parseEther("0.666666666666666666")
      );

      await expect(
        tokenSchedule.connect(admin).updateGaugeWeight(await mockGauge1.getAddress(), ethers.parseEther("3"))
      )
        .to.emit(tokenSchedule, "UpdateGaugeWeight")
        .withArgs(await mockGauge1.getAddress(), ethers.parseEther("1"), ethers.parseEther("3"));
      expect(await tokenSchedule.getWeight(await mockGauge1.getAddress())).to.eq(ethers.parseEther("3"));
      expect(await tokenSchedule.totalWeight()).to.eq(ethers.parseEther("5"));
      expect(await tokenSchedule.getNormalizedWeight(await mockGauge1.getAddress())).to.eq(ethers.parseEther("0.6"));
      expect(await tokenSchedule.getNormalizedWeight(await mockGauge2.getAddress())).to.eq(ethers.parseEther("0.4"));

      await expect(tokenSchedule.connect(admin).updateGaugeWeight(await mockGauge1.getAddress(), 0n))
        .to.emit(tokenSchedule, "UpdateGaugeWeight")
        .withArgs(await mockGauge1.getAddress(), ethers.parseEther("3"), 0n);
      expect(await tokenSchedule.getWeight(await mockGauge1.getAddress())).to.eq(0n);
      expect(await tokenSchedule.totalWeight()).to.eq(ethers.parseEther("2"));
      expect(await tokenSchedule.getNormalizedWeight(await mockGauge1.getAddress())).to.eq(ethers.parseEther("0"));
      expect(await tokenSchedule.getNormalizedWeight(await mockGauge2.getAddress())).to.eq(ethers.parseEther("1"));
    });
  });

  context("distribute", async () => {
    beforeEach(async () => {
      // Set up gauge weights
      await tokenSchedule.connect(admin).updateGaugeWeight(await mockGauge1.getAddress(), ethers.parseEther("1"));
      await tokenSchedule.connect(admin).updateGaugeWeight(await mockGauge2.getAddress(), ethers.parseEther("2"));
      await tokenSchedule.connect(admin).updateGaugeWeight(await mockGauge3.getAddress(), ethers.parseEther("3"));

      // Register reward tokens
      await mockGauge1.grantRole(await mockGauge1.REWARD_MANAGER_ROLE(), admin.address);
      await mockGauge2.grantRole(await mockGauge2.REWARD_MANAGER_ROLE(), admin.address);
      await mockGauge3.grantRole(await mockGauge3.REWARD_MANAGER_ROLE(), admin.address);

      await mockGauge1.registerRewardToken(await governanceToken.getAddress(), await tokenSchedule.getAddress());
      await mockGauge2.registerRewardToken(await governanceToken.getAddress(), await tokenSchedule.getAddress());
      await mockGauge3.registerRewardToken(await governanceToken.getAddress(), await tokenSchedule.getAddress());
    });

    it("should revert when caller is not distributor", async () => {
      await expect(tokenSchedule.connect(admin).distribute())
        .to.revertedWithCustomError(tokenSchedule, "AccessControlUnauthorizedAccount")
        .withArgs(await admin.getAddress(), await tokenSchedule.DISTRIBUTOR_ROLE());
    });

    it("should distribute rewards correctly", async () => {
      // Move time forward to generate some rewards
      const timeElapsed = 1000; // 1000 seconds
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        Number(await tokenMinter.getStartEpochTime()) + timeElapsed,
      ]);
      await expect(tokenSchedule.connect(distributor).distribute()).to.emit(tokenSchedule, "DistributeRewards");

      const expectedRewards = INIT_RATE * BigInt(timeElapsed);
      const gauge1Rewards = (expectedRewards * ethers.parseEther("1")) / ethers.parseEther("6");
      const gauge2Rewards = (expectedRewards * ethers.parseEther("2")) / ethers.parseEther("6");
      const gauge3Rewards = (expectedRewards * ethers.parseEther("3")) / ethers.parseEther("6");

      expect(await governanceToken.balanceOf(await mockGauge1.getAddress())).to.closeTo(
        gauge1Rewards,
        gauge1Rewards / 1000000n
      );
      expect(await governanceToken.balanceOf(await mockGauge2.getAddress())).to.closeTo(
        gauge2Rewards,
        gauge2Rewards / 1000000n
      );
      expect(await governanceToken.balanceOf(await mockGauge3.getAddress())).to.closeTo(
        gauge3Rewards,
        gauge3Rewards / 1000000n
      );
    });
  });
});
