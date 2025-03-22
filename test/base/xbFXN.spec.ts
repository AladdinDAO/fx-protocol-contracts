import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { TokenSchedule, TokenMinter, BFXN, XbFXN, Gauge } from "@/types/index";

describe("xbFXN.spec", async () => {
  let admin: HardhatEthersSigner;
  let distributor: HardhatEthersSigner;

  let tokenSchedule: TokenSchedule;
  let tokenMinter: TokenMinter;
  let governanceToken: BFXN;
  let stakedToken: XbFXN;
  let gauge: Gauge;

  const DAY_SECONDS = 86400;
  const MAX_CANCEL_DURATION = 14 * 24 * 60 * 60; // 15 days
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
    const StakedTokenProxy = await TransparentUpgradeableProxy.deploy(
      proxyAdmin.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );
    const GaugeProxy = await TransparentUpgradeableProxy.deploy(proxyAdmin.getAddress(), proxyAdmin.getAddress(), "0x");

    const GovernanceToken = await ethers.getContractFactory("bFXN", admin);
    const GovernanceTokenImplementation = await GovernanceToken.deploy(TokenMinterProxy.getAddress());
    await proxyAdmin.upgrade(GovernanceTokenProxy.getAddress(), GovernanceTokenImplementation.getAddress());

    const TokenMinter = await ethers.getContractFactory("TokenMinter", admin);
    const TokenMinterImplementation = await TokenMinter.deploy(GovernanceTokenProxy.getAddress());
    await proxyAdmin.upgrade(TokenMinterProxy.getAddress(), TokenMinterImplementation.getAddress());

    const TokenSchedule = await ethers.getContractFactory("TokenSchedule", admin);
    const TokenScheduleImplementation = await TokenSchedule.deploy(TokenMinterProxy.getAddress());
    await proxyAdmin.upgrade(TokenScheduleProxy.getAddress(), TokenScheduleImplementation.getAddress());

    const Gauge = await ethers.getContractFactory("Gauge", admin);
    const GaugeImplementation = await Gauge.deploy(GovernanceTokenProxy.getAddress(), StakedTokenProxy.getAddress());
    await proxyAdmin.upgrade(GaugeProxy.getAddress(), GaugeImplementation.getAddress());

    const StakedToken = await ethers.getContractFactory("xbFXN", admin);
    const StakedTokenImplementation = await StakedToken.deploy(
      GovernanceTokenProxy.getAddress(),
      GaugeProxy.getAddress()
    );
    await proxyAdmin.upgrade(StakedTokenProxy.getAddress(), StakedTokenImplementation.getAddress());

    governanceToken = (await ethers.getContractAt("bFXN", await GovernanceTokenProxy.getAddress())) as any as BFXN;
    tokenMinter = (await ethers.getContractAt(
      "TokenMinter",
      await TokenMinterProxy.getAddress()
    )) as any as TokenMinter;
    tokenSchedule = (await ethers.getContractAt(
      "TokenSchedule",
      await TokenScheduleProxy.getAddress()
    )) as any as TokenSchedule;
    gauge = (await ethers.getContractAt("Gauge", await GaugeProxy.getAddress())) as any as Gauge;
    stakedToken = (await ethers.getContractAt("xbFXN", await StakedTokenProxy.getAddress())) as any as XbFXN;

    await governanceToken.initialize("Governance Token", "GOV");
    await tokenMinter.initialize(INIT_SUPPLY, INIT_RATE, RATE_REDUCTION_COEFFICIENT);
    await tokenSchedule.initialize();
    await stakedToken.initialize("Staked Token", "xbFXN");
    await gauge.initialize(stakedToken.getAddress());

    // Grant roles
    await tokenMinter.grantRole(await tokenMinter.MINTER_ROLE(), tokenSchedule.getAddress());
    await tokenSchedule.grantRole(await tokenSchedule.DISTRIBUTOR_ROLE(), distributor.address);
    await stakedToken.grantRole(await stakedToken.DISTRIBUTOR_ROLE(), distributor.address);
    await gauge.grantRole(await gauge.REWARD_MANAGER_ROLE(), admin.address);
    await gauge.registerRewardToken(stakedToken.getAddress(), stakedToken.getAddress());
  });

  describe("initialize", () => {
    it("should initialize successfully", async () => {
      expect(await stakedToken.name()).to.equal("Staked Token");
      expect(await stakedToken.symbol()).to.equal("xbFXN");
      expect(await stakedToken.bFXN()).to.equal(await governanceToken.getAddress());
      expect(await stakedToken.gauge()).to.equal(await gauge.getAddress());

      await expect(stakedToken.initialize("Staked Token", "xbFXN")).to.be.revertedWithCustomError(
        stakedToken,
        "InvalidInitialization"
      );
    });
  });

  describe("stake", () => {
    let user: HardhatEthersSigner;
    const STAKE_AMOUNT = ethers.parseEther("1000"); // 1000 tokens

    beforeEach(async () => {
      [admin, distributor, user] = await ethers.getSigners();

      // Mint some tokens to user for testing
      await governanceToken.transfer(user.address, STAKE_AMOUNT * 2n);
      await governanceToken.connect(user).approve(stakedToken.getAddress(), STAKE_AMOUNT * 2n);
    });

    it("should stake successfully", async () => {
      const balanceBefore = await governanceToken.balanceOf(user.address);
      const stakedBalanceBefore = await stakedToken.balanceOf(user.address);
      const totalSupplyBefore = await stakedToken.totalSupply();

      await stakedToken.connect(user).stake(STAKE_AMOUNT, user.address);

      const balanceAfter = await governanceToken.balanceOf(user.address);
      const stakedBalanceAfter = await stakedToken.balanceOf(user.address);
      const totalSupplyAfter = await stakedToken.totalSupply();

      expect(balanceAfter).to.equal(balanceBefore - STAKE_AMOUNT);
      expect(stakedBalanceAfter).to.equal(stakedBalanceBefore + STAKE_AMOUNT);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore + STAKE_AMOUNT);
    });

    it("should fail to stake with zero amount", async () => {
      await expect(stakedToken.connect(user).stake(0, user.address)).to.be.revertedWithCustomError(
        stakedToken,
        "ErrorZeroAmount"
      );
    });

    it("should fail to stake with insufficient allowance", async () => {
      await expect(stakedToken.connect(user).stake(STAKE_AMOUNT * 3n, user.address)).to.be.revertedWithCustomError(
        governanceToken,
        "ERC20InsufficientAllowance"
      );
    });

    it("should fail to stake with insufficient balance", async () => {
      await governanceToken.connect(user).approve(stakedToken.getAddress(), STAKE_AMOUNT * 3n);
      await expect(stakedToken.connect(user).stake(STAKE_AMOUNT * 3n, user.address)).to.be.revertedWithCustomError(
        governanceToken,
        "ERC20InsufficientBalance"
      );
    });

    it("should stake to different recipient", async () => {
      const recipient = (await ethers.getSigners())[3];
      const balanceBefore = await governanceToken.balanceOf(user.address);
      const stakedBalanceBefore = await stakedToken.balanceOf(recipient.address);
      const totalSupplyBefore = await stakedToken.totalSupply();

      await stakedToken.connect(user).stake(STAKE_AMOUNT, recipient.address);

      const balanceAfter = await governanceToken.balanceOf(user.address);
      const stakedBalanceAfter = await stakedToken.balanceOf(recipient.address);
      const totalSupplyAfter = await stakedToken.totalSupply();

      expect(balanceAfter).to.equal(balanceBefore - STAKE_AMOUNT);
      expect(stakedBalanceAfter).to.equal(stakedBalanceBefore + STAKE_AMOUNT);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore + STAKE_AMOUNT);
    });

    it("should emit Stake event", async () => {
      await expect(stakedToken.connect(user).stake(STAKE_AMOUNT, user.address))
        .to.emit(stakedToken, "Stake")
        .withArgs(user.address, user.address, STAKE_AMOUNT);
    });
  });

  describe("vesting", () => {
    let user: HardhatEthersSigner;
    const VEST_AMOUNT = ethers.parseEther("1000"); // 1000 tokens
    const VEST_DURATION = 30 * 24 * 60 * 60; // 30 days

    beforeEach(async () => {
      [admin, distributor, user] = await ethers.getSigners();

      // Mint some tokens to user for testing
      await governanceToken.transfer(user.address, VEST_AMOUNT * 3n);
      await governanceToken.connect(user).approve(stakedToken.getAddress(), VEST_AMOUNT * 3n);
    });

    it("should create vesting successfully", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      const balanceBefore = await stakedToken.balanceOf(user.address);
      const tx = await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);
      const startTimestamp = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);
      const balanceAfter = await stakedToken.balanceOf(user.address);

      const penalty = (VEST_AMOUNT * 454545455n) / 10n ** 9n;
      await expect(tx).to.emit(stakedToken, "Vest").withArgs(user.address, 0, VEST_DURATION, VEST_AMOUNT, penalty);

      expect(balanceAfter).to.equal(balanceBefore - VEST_AMOUNT);

      const vestings = await stakedToken.getUserVestings(user.address);
      expect(vestings.length).to.equal(1);
      expect(vestings[0].amount).to.equal(VEST_AMOUNT);
      expect(vestings[0].startTimestamp).to.equal(startTimestamp);
      expect(vestings[0].finishTimestamp).to.equal(startTimestamp + VEST_DURATION);
      expect(vestings[0].cancelled).to.equal(false);
      expect(vestings[0].claimed).to.equal(false);

      // check penalty
      const cancelTimestamp = startTimestamp + MAX_CANCEL_DURATION;
      const cancelDay = Math.floor((cancelTimestamp + DAY_SECONDS - 1) / DAY_SECONDS) * DAY_SECONDS;
      expect(await stakedToken.exitPenalty(cancelDay)).to.equal(penalty);
    });

    it("should fail to create vesting with invalid duration", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);

      // Test duration too short
      await expect(
        stakedToken.connect(user).createVest(VEST_AMOUNT, 15 * 24 * 60 * 60 - 1) // 15 days - 1 second
      ).to.be.revertedWithCustomError(stakedToken, "ErrorInvalidVestingDuration");

      // Test duration too long
      await expect(
        stakedToken.connect(user).createVest(VEST_AMOUNT, 180 * 24 * 60 * 60 + 1) // 180 days + 1 second
      ).to.be.revertedWithCustomError(stakedToken, "ErrorInvalidVestingDuration");
    });

    it("should fail to create vesting with insufficient balance", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);

      await expect(stakedToken.connect(user).createVest(VEST_AMOUNT * 2n, VEST_DURATION)).to.be.revertedWithCustomError(
        stakedToken,
        "ERC20InsufficientBalance"
      );
    });

    it("should cancel vesting successfully", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);
      const startTimestamp = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);

      const balanceBefore = await stakedToken.balanceOf(user.address);
      await expect(stakedToken.connect(user).cancelVest(0))
        .to.emit(stakedToken, "CancelVest")
        .withArgs(user.address, 0);
      const balanceAfter = await stakedToken.balanceOf(user.address);

      expect(balanceAfter).to.equal(balanceBefore + VEST_AMOUNT);

      const vestings = await stakedToken.getUserVestings(user.address);
      expect(vestings[0].cancelled).to.equal(true);

      // check penalty
      const cancelTimestamp = startTimestamp + MAX_CANCEL_DURATION;
      const cancelDay = Math.floor((cancelTimestamp + DAY_SECONDS - 1) / DAY_SECONDS) * DAY_SECONDS;
      expect(await stakedToken.exitPenalty(cancelDay)).to.equal(0n);
    });

    it("should fail to cancel vesting after max cancel duration", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [15 * 24 * 60 * 60]); // 15 days
      await ethers.provider.send("evm_mine");

      await expect(stakedToken.connect(user).cancelVest(0)).to.be.revertedWithCustomError(
        stakedToken,
        "ErrorVestingCannotBeCancelled"
      );
    });

    it("should fail to cancel vesting with invalid id", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);

      await expect(stakedToken.connect(user).cancelVest(1)).to.be.revertedWithCustomError(
        stakedToken,
        "ErrorInvalidVestingId"
      );
    });

    it("should fail to cancel vesting that is already cancelled", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);
      await stakedToken.connect(user).cancelVest(0);

      await expect(stakedToken.connect(user).cancelVest(0)).to.be.revertedWithCustomError(
        stakedToken,
        "ErrorVestingAlreadyCancelled"
      );
    });

    it("should claim vesting successfully", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);
      const startTimestamp = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);

      // Fast forward time past vesting period
      await ethers.provider.send("evm_increaseTime", [VEST_DURATION + 1]);
      await ethers.provider.send("evm_mine");

      // check penalty
      const cancelTimestamp = startTimestamp + MAX_CANCEL_DURATION;
      const cancelDay = Math.floor((cancelTimestamp + DAY_SECONDS - 1) / DAY_SECONDS) * DAY_SECONDS;
      const penalty = await stakedToken.exitPenalty(cancelDay);

      const balanceBefore = await governanceToken.balanceOf(user.address);
      await expect(stakedToken.connect(user).claimVest(0))
        .to.emit(stakedToken, "ClaimVest")
        .withArgs(user.address, 0, VEST_AMOUNT, penalty);
      const balanceAfter = await governanceToken.balanceOf(user.address);

      // Check that user received tokens (minus penalty)
      expect(balanceAfter).to.be.eq(balanceBefore + VEST_AMOUNT - penalty);

      const vestings = await stakedToken.getUserVestings(user.address);
      expect(vestings[0].claimed).to.equal(true);
    });

    it("should fail to claim vesting before end time", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);

      await expect(stakedToken.connect(user).claimVest(0)).to.be.revertedWithCustomError(
        stakedToken,
        "ErrorVestingNotFinished"
      );
    });

    it("should fail to claim vesting with invalid id", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);

      // Fast forward time past vesting period
      await ethers.provider.send("evm_increaseTime", [VEST_DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(stakedToken.connect(user).claimVest(1)).to.be.revertedWithCustomError(
        stakedToken,
        "ErrorInvalidVestingId"
      );
    });

    it("should fail to claim vesting that is already claimed", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);

      // Fast forward time past vesting period
      await ethers.provider.send("evm_increaseTime", [VEST_DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await stakedToken.connect(user).claimVest(0);

      await expect(stakedToken.connect(user).claimVest(0)).to.be.revertedWithCustomError(
        stakedToken,
        "ErrorVestingAlreadyClaimed"
      );
    });

    it("should fail to claim vesting that is cancelled", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);
      await stakedToken.connect(user).cancelVest(0);

      // Fast forward time past vesting period
      await ethers.provider.send("evm_increaseTime", [VEST_DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(stakedToken.connect(user).claimVest(0)).to.be.revertedWithCustomError(
        stakedToken,
        "ErrorVestingAlreadyCancelled"
      );
    });

    it("should claim multiple vestings successfully", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT * 2n, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);

      // Fast forward time past vesting period
      await ethers.provider.send("evm_increaseTime", [VEST_DURATION + 1]);
      await ethers.provider.send("evm_mine");

      const balanceBefore = await governanceToken.balanceOf(user.address);
      await stakedToken.connect(user).claimVests([0, 1]);
      const balanceAfter = await governanceToken.balanceOf(user.address);

      // Check that user received tokens (minus penalties)
      expect(balanceAfter).to.be.gt(balanceBefore);

      const vestings = await stakedToken.getUserVestings(user.address);
      expect(vestings[0].claimed).to.equal(true);
      expect(vestings[1].claimed).to.equal(true);
    });

    it("should fail to claim multiple vestings with invalid ids", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT * 2n, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);

      // Fast forward time past vesting period
      await ethers.provider.send("evm_increaseTime", [VEST_DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(stakedToken.connect(user).claimVests([0, 2])).to.be.revertedWithCustomError(
        stakedToken,
        "ErrorInvalidVestingId"
      );
    });

    it("should fail to claim multiple vestings with duplicate ids", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT * 2n, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, VEST_DURATION);

      // Fast forward time past vesting period
      await ethers.provider.send("evm_increaseTime", [VEST_DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(stakedToken.connect(user).claimVests([0, 0])).to.be.revertedWithCustomError(
        stakedToken,
        "ErrorVestingAlreadyClaimed"
      );
    });

    it("should calculate penalty correctly for minimum duration", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      const MIN_DURATION = 15 * 24 * 60 * 60; // 15 days
      await stakedToken.connect(user).createVest(VEST_AMOUNT, MIN_DURATION);
      const startTimestamp = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);

      // Expected penalty: 50% of amount
      const expectedPenalty = VEST_AMOUNT / 2n;
      const cancelTimestamp = startTimestamp + MAX_CANCEL_DURATION;
      const cancelDay = Math.floor((cancelTimestamp + DAY_SECONDS - 1) / DAY_SECONDS) * DAY_SECONDS;
      expect(await stakedToken.exitPenalty(cancelDay)).to.equal(expectedPenalty);
    });

    it("should calculate penalty correctly for maximum duration", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      const MAX_DURATION = 180 * 24 * 60 * 60; // 180 days
      await stakedToken.connect(user).createVest(VEST_AMOUNT, MAX_DURATION);
      const startTimestamp = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);

      // Expected penalty: 0% of amount
      const expectedPenalty = 0n;
      const cancelTimestamp = startTimestamp + MAX_CANCEL_DURATION;
      const cancelDay = Math.floor((cancelTimestamp + DAY_SECONDS - 1) / DAY_SECONDS) * DAY_SECONDS;
      expect(await stakedToken.exitPenalty(cancelDay)).to.equal(expectedPenalty);
    });

    it("should calculate penalty correctly for middle duration", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      const MID_DURATION = 97 * 24 * 60 * 60; // 97 days (middle between 15 and 180)
      await stakedToken.connect(user).createVest(VEST_AMOUNT, MID_DURATION);
      const startTimestamp = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);

      // Expected penalty: ~25% of amount
      // r = 0.5 * (97 - 15) / (180 - 15) + 0.5 = 0.75
      // p = amount * (1 - 0.75) = amount * 0.251515152
      const expectedPenalty = (VEST_AMOUNT * 251515152n) / 10n ** 9n;
      const cancelTimestamp = startTimestamp + MAX_CANCEL_DURATION;
      const cancelDay = Math.floor((cancelTimestamp + DAY_SECONDS - 1) / DAY_SECONDS) * DAY_SECONDS;
      expect(await stakedToken.exitPenalty(cancelDay)).to.equal(expectedPenalty);
    });

    it("should calculate penalty correctly for multiple vestings", async () => {
      await stakedToken.connect(user).stake(VEST_AMOUNT * 3n, user.address);
      const MIN_DURATION = 15 * 24 * 60 * 60; // 15 days
      const MID_DURATION = 97 * 24 * 60 * 60; // 97 days (middle between 15 and 180)
      const MAX_DURATION = 180 * 24 * 60 * 60; // 180 days
      await stakedToken.connect(user).createVest(VEST_AMOUNT, MIN_DURATION);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, MID_DURATION);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, MAX_DURATION);
      const startTimestamp = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);

      // Expected total penalty: 50% of first amount + 25% of third amount + 0% of second amount
      const expectedPenalty = VEST_AMOUNT / 2n + (VEST_AMOUNT * 251515152n) / 10n ** 9n;
      const cancelTimestamp = startTimestamp + MAX_CANCEL_DURATION;
      const cancelDay = Math.floor((cancelTimestamp + DAY_SECONDS - 1) / DAY_SECONDS) * DAY_SECONDS;
      expect(await stakedToken.exitPenalty(cancelDay)).to.equal(expectedPenalty);
    });
  });

  describe("distributeExitPenalty", () => {
    let user: HardhatEthersSigner;
    const VEST_AMOUNT = ethers.parseEther("1000"); // 1000 tokens
    const MIN_DURATION = 15 * 24 * 60 * 60; // 15 days
    const MID_DURATION = 97 * 24 * 60 * 60; // 97 days

    beforeEach(async () => {
      [admin, distributor, user] = await ethers.getSigners();

      // Mint some tokens to user for testing
      await governanceToken.transfer(user.address, VEST_AMOUNT * 3n);
      await governanceToken.connect(user).approve(stakedToken.getAddress(), VEST_AMOUNT * 3n);
    });

    it("should clear exitPenalty after distribution", async () => {
      // Create vesting with minimum duration (50% penalty)
      await stakedToken.connect(user).stake(VEST_AMOUNT, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, MIN_DURATION);
      const startTimestamp = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);

      // Calculate cancel day
      const cancelTimestamp = startTimestamp + MAX_CANCEL_DURATION;
      const cancelDay = Math.floor((cancelTimestamp + DAY_SECONDS - 1) / DAY_SECONDS) * DAY_SECONDS;

      // Verify initial penalty
      const initialPenalty = await stakedToken.exitPenalty(cancelDay);
      expect(initialPenalty).to.equal(VEST_AMOUNT / 2n);

      await ethers.provider.send("evm_setNextBlockTimestamp", [cancelDay + 1]);
      await ethers.provider.send("evm_mine");

      // Distribute penalty
      const balanceBefore = await stakedToken.balanceOf(gauge.getAddress());
      await stakedToken.connect(distributor).distributeExitPenalty();
      const balanceAfter = await stakedToken.balanceOf(gauge.getAddress());
      expect(balanceAfter).to.equal(balanceBefore + initialPenalty);
      expect(await stakedToken.nextActiveDay()).to.equal(cancelDay + DAY_SECONDS);

      const finalPenalty = await stakedToken.exitPenalty(cancelDay);
      expect(finalPenalty).to.equal(initialPenalty);
    });

    it("should handle multiple distributions correctly", async () => {
      // Create vesting with minimum duration (50% penalty)
      await stakedToken.connect(user).stake(VEST_AMOUNT * 2n, user.address);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, MIN_DURATION);
      const startTimestamp0 = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);

      await ethers.provider.send("evm_setNextBlockTimestamp", [startTimestamp0 + DAY_SECONDS]);
      await stakedToken.connect(user).createVest(VEST_AMOUNT, MID_DURATION);
      const startTimestamp1 = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);

      // Calculate cancel day
      const cancelTimestamp0 = startTimestamp0 + MAX_CANCEL_DURATION;
      const cancelDay0 = Math.floor((cancelTimestamp0 + DAY_SECONDS - 1) / DAY_SECONDS) * DAY_SECONDS;
      const cancelTimestamp1 = startTimestamp1 + MAX_CANCEL_DURATION;
      const cancelDay1 = Math.floor((cancelTimestamp1 + DAY_SECONDS - 1) / DAY_SECONDS) * DAY_SECONDS;

      // Verify initial penalty
      const initialPenalty0 = await stakedToken.exitPenalty(cancelDay0);
      expect(initialPenalty0).to.equal(VEST_AMOUNT / 2n);
      const initialPenalty1 = await stakedToken.exitPenalty(cancelDay1);
      expect(initialPenalty1).to.equal((VEST_AMOUNT * 251515152n) / 10n ** 9n);

      await ethers.provider.send("evm_setNextBlockTimestamp", [cancelDay1 + 1]);
      await ethers.provider.send("evm_mine");

      // distribution
      const balanceBefore = await stakedToken.balanceOf(gauge.getAddress());
      await expect(stakedToken.connect(distributor).distributeExitPenalty())
        .to.emit(stakedToken, "DistributeExitPenalty")
        .withArgs(cancelDay0, initialPenalty0)
        .to.emit(stakedToken, "DistributeExitPenalty")
        .withArgs(cancelDay1, initialPenalty1);
      const balanceAfter = await stakedToken.balanceOf(gauge.getAddress());
      expect(await stakedToken.exitPenalty(cancelDay0)).to.equal(initialPenalty0);
      expect(await stakedToken.exitPenalty(cancelDay1)).to.equal(initialPenalty1);
      expect(await stakedToken.nextActiveDay()).to.equal(cancelDay1 + DAY_SECONDS);
      expect(balanceAfter).to.equal(balanceBefore + initialPenalty0 + initialPenalty1);
    });
  });
});
