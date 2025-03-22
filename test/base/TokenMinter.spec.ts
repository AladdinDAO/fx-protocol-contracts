import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { expect } from "chai";
import { ethers, network } from "hardhat";

import { BFXN, TokenMinter } from "@/types/index";

describe("TokenMinter", function () {
  let tokenMinter: TokenMinter;
  let governanceToken: BFXN;

  let deployer: HardhatEthersSigner;
  let minter: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let StartEpochTime: bigint;

  const INIT_SUPPLY = ethers.parseEther("122000000"); // 122M tokens
  const INIT_RATE = ethers.parseEther("0.247336377473363774"); // 0.247336377473363774 tokens per second
  const RATE_REDUCTION_TIME = 365n * 24n * 60n * 60n; // 1 year in seconds
  const RATE_REDUCTION_COEFFICIENT = 1111111111111111111n; // 10/9 * 1e18

  beforeEach(async function () {
    [deployer, minter, user] = await ethers.getSigners();

    const ProxyAdmin = await ethers.getContractFactory("ProxyAdmin", deployer);
    const TransparentUpgradeableProxy = await ethers.getContractFactory("TransparentUpgradeableProxy", deployer);

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

    const GovernanceToken = await ethers.getContractFactory("bFXN", deployer);
    const GovernanceTokenImplementation = await GovernanceToken.deploy(TokenMinterProxy.getAddress());
    await proxyAdmin
      .upgrade(GovernanceTokenProxy.getAddress(), GovernanceTokenImplementation.getAddress());

    const TokenMinter = await ethers.getContractFactory("TokenMinter", deployer);
    const TokenMinterImplementation = await TokenMinter.deploy(GovernanceTokenProxy.getAddress());
    await proxyAdmin.upgrade(TokenMinterProxy.getAddress(), TokenMinterImplementation.getAddress());

    governanceToken = (await ethers.getContractAt("bFXN", await GovernanceTokenProxy.getAddress())) as any as BFXN;
    tokenMinter = (await ethers.getContractAt(
      "TokenMinter",
      await TokenMinterProxy.getAddress()
    )) as any as TokenMinter;

    await governanceToken.initialize("bFXN", "bFXN");
    await tokenMinter.initialize(INIT_SUPPLY, INIT_RATE, RATE_REDUCTION_COEFFICIENT);
    StartEpochTime = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    await tokenMinter.grantRole(await tokenMinter.MINTER_ROLE(), await minter.getAddress());
  });

  describe("Initialization", function () {
    it("should initialize with correct parameters", async function () {
      expect(await tokenMinter.getStartEpochSupply()).to.equal(INIT_SUPPLY);
      expect(await tokenMinter.getInflationRate()).to.equal(INIT_RATE);
      expect(await tokenMinter.getMiningEpoch()).to.equal(0);
      expect(await tokenMinter.getStartEpochTime()).to.equal(StartEpochTime);
      expect(await tokenMinter.getFutureEpochTime()).to.equal(StartEpochTime + RATE_REDUCTION_TIME);
      expect(await tokenMinter.rateReductionCoefficient()).to.equal(RATE_REDUCTION_COEFFICIENT);
      expect(await tokenMinter.hasRole(await tokenMinter.DEFAULT_ADMIN_ROLE(), deployer.address)).to.equal(true);
      expect(await governanceToken.totalSupply()).to.equal(INIT_SUPPLY);
    });
  });

  describe("Single Epoch Minting", function () {
    it("should not allow non-minter to mint", async function () {
      const mintAmount = ethers.parseEther("1000");
      await expect(tokenMinter.connect(user).mint(await user.getAddress(), mintAmount))
        .to.be.revertedWithCustomError(tokenMinter, "AccessControlUnauthorizedAccount")
        .withArgs(await user.getAddress(), await tokenMinter.MINTER_ROLE());
    });

    it("should mint tokens within the same epoch", async function () {
      const mintAmount = ethers.parseEther("1000");
      const duration = mintAmount / INIT_RATE;
      await network.provider.send("evm_setNextBlockTimestamp", [Number(StartEpochTime + duration) + 10]);
      await tokenMinter.connect(minter).mint(await user.getAddress(), mintAmount);
      expect(await governanceToken.balanceOf(await user.getAddress())).to.equal(mintAmount);
      expect(await governanceToken.totalSupply()).to.equal(INIT_SUPPLY + mintAmount);
    });

    it("should not exceed available supply in same epoch", async function () {
      const mintAmount = ethers.parseEther("1000");
      const duration = mintAmount / INIT_RATE;
      const availableSupply = await tokenMinter.getAvailableSupply();
      await network.provider.send("evm_setNextBlockTimestamp", [Number(StartEpochTime + duration) - 10]);
      await network.provider.send("evm_mine", []);
      await expect(
        tokenMinter.connect(minter).mint(await user.getAddress(), availableSupply + 1n)
      ).to.be.revertedWithCustomError(tokenMinter, "ErrorMintExceedsAvailableSupply");
    });

    it("should correctly calculate mintable amount", async function () {
      const mintAmount = ethers.parseEther("1000");
      const initialDuration = mintAmount / INIT_RATE;
      let duration = mintAmount / INIT_RATE;
      let mintableAmount = await tokenMinter.mintableInTimeframe(StartEpochTime, StartEpochTime + duration);
      expect(mintableAmount).to.equal(INIT_RATE * initialDuration);

      duration += RATE_REDUCTION_TIME;
      mintableAmount = await tokenMinter.mintableInTimeframe(StartEpochTime, StartEpochTime + duration);
      expect(mintableAmount).to.closeTo(
        INIT_RATE * RATE_REDUCTION_TIME + ((INIT_RATE * 10n ** 18n) / RATE_REDUCTION_COEFFICIENT) * initialDuration,
        mintableAmount / 1000000n
      );

      duration += RATE_REDUCTION_TIME;
      await expect(
        tokenMinter.mintableInTimeframe(StartEpochTime, StartEpochTime + duration)
      ).to.be.revertedWithCustomError(tokenMinter, "ErrorTooFarInFuture");
    });
  });

  describe("Edge Cases", function () {
    it("should handle minting at epoch boundary", async function () {
      // Move to just before epoch boundary
      await ethers.provider.send("evm_increaseTime", [Number(RATE_REDUCTION_TIME - 1n)]);
      await ethers.provider.send("evm_mine");

      const mintAmount = ethers.parseEther("1000");
      await tokenMinter.connect(minter).mint(await user.getAddress(), mintAmount);

      // Move past boundary
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      // Should still be able to mint
      await tokenMinter.connect(minter).mint(await user.getAddress(), mintAmount);
      expect(await governanceToken.balanceOf(await user.getAddress())).to.equal(mintAmount * 2n);
    });

    it("should not allow minting too far in future", async function () {
      const futureTime = (await tokenMinter.getStartEpochTime()) + RATE_REDUCTION_TIME * 3n;
      await expect(
        tokenMinter.mintableInTimeframe(await tokenMinter.getStartEpochTime(), futureTime)
      ).to.be.revertedWithCustomError(tokenMinter, "ErrorTooFarInFuture");
    });

    it("should not allow invalid timeframes", async function () {
      const start = await tokenMinter.getStartEpochTime();
      const end = start - 1n;
      await expect(tokenMinter.mintableInTimeframe(start, end)).to.be.revertedWithCustomError(
        tokenMinter,
        "ErrorInvalidTimeframe"
      );
    });
  });

  describe("updateMiningParameters", function () {
    it("should not allow update before epoch is finished", async function () {
      await expect(tokenMinter.updateMiningParameters()).to.be.revertedWithCustomError(
        tokenMinter,
        "ErrorEpochNotFinished"
      );
    });

    it("should correctly update parameters after epoch", async function () {
      // Move to next epoch
      await network.provider.send("evm_setNextBlockTimestamp", [Number(StartEpochTime + RATE_REDUCTION_TIME + 1n)]);
      await network.provider.send("evm_mine");

      const initialRate = await tokenMinter.getInflationRate();
      const initialSupply = await tokenMinter.getStartEpochSupply();
      const initialEpoch = await tokenMinter.getMiningEpoch();

      await tokenMinter.updateMiningParameters();

      const newRate = await tokenMinter.getInflationRate();
      const newSupply = await tokenMinter.getStartEpochSupply();
      const newEpoch = await tokenMinter.getMiningEpoch();

      // Rate should be reduced by RATE_REDUCTION_COEFFICIENT
      expect(newRate).to.equal((initialRate * 10n ** 18n) / RATE_REDUCTION_COEFFICIENT);
      // Supply should increase by initial rate * RATE_REDUCTION_TIME
      expect(newSupply).to.equal(initialSupply + initialRate * RATE_REDUCTION_TIME);
      // Epoch should increment
      expect(newEpoch).to.equal(initialEpoch + 1n);
    });

    it("should emit MiningParametersUpdated event", async function () {
      // Move to next epoch
      await network.provider.send("evm_setNextBlockTimestamp", [Number(StartEpochTime + RATE_REDUCTION_TIME + 1n)]);
      await network.provider.send("evm_mine");

      const initialRate = await tokenMinter.getInflationRate();
      const initialSupply = await tokenMinter.getStartEpochSupply();
      const expectedNewRate = (initialRate * 10n ** 18n) / RATE_REDUCTION_COEFFICIENT;
      const expectedNewSupply = initialSupply + initialRate * RATE_REDUCTION_TIME;

      await expect(tokenMinter.updateMiningParameters())
        .to.emit(tokenMinter, "MiningParametersUpdated")
        .withArgs(expectedNewRate, expectedNewSupply);
    });

    it("should update start epoch time correctly", async function () {
      // Move to next epoch
      await network.provider.send("evm_setNextBlockTimestamp", [Number(StartEpochTime + RATE_REDUCTION_TIME + 1n)]);
      await network.provider.send("evm_mine");

      const initialStartTime = await tokenMinter.getStartEpochTime();
      await tokenMinter.updateMiningParameters();
      const newStartTime = await tokenMinter.getStartEpochTime();

      expect(newStartTime).to.equal(initialStartTime + RATE_REDUCTION_TIME);
    });

    it("should maintain correct future epoch time after update", async function () {
      // Move to next epoch
      await network.provider.send("evm_setNextBlockTimestamp", [Number(StartEpochTime + RATE_REDUCTION_TIME + 1n)]);
      await network.provider.send("evm_mine");

      const initialFutureTime = await tokenMinter.getFutureEpochTime();
      await tokenMinter.updateMiningParameters();
      const newFutureTime = await tokenMinter.getFutureEpochTime();

      expect(newFutureTime).to.equal(initialFutureTime + RATE_REDUCTION_TIME);
    });
  });

  describe("Multiple Epochs", function () {
    it("should handle multiple epoch transitions", async function () {
      // Mint in first epoch
      const firstEpochMint = ethers.parseEther("1000");
      const duration = firstEpochMint / INIT_RATE + 10n;
      await network.provider.send("evm_setNextBlockTimestamp", [Number(StartEpochTime + duration)]);
      await network.provider.send("evm_mine");
      await tokenMinter.connect(minter).mint(await user.getAddress(), firstEpochMint);

      // Move through multiple epochs
      for (let i = 0; i < 3; i++) {
        await ethers.provider.send("evm_increaseTime", [Number(RATE_REDUCTION_TIME + duration)]);
        await ethers.provider.send("evm_mine");
        
        const mintAmount = ethers.parseEther("1000");
        await tokenMinter.connect(minter).mint(await user.getAddress(), mintAmount);
      }

      const expectedBalance = firstEpochMint + ethers.parseEther("3000");
      expect(await governanceToken.balanceOf(await user.getAddress())).to.equal(expectedBalance);
    });
  });
});
