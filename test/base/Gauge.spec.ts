import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { TokenSchedule, TokenMinter, BFXN, XbFXN, Gauge, MockERC20 } from "@/types/index";

describe("Gauge.spec", async () => {
  let admin: HardhatEthersSigner;
  let distributor: HardhatEthersSigner;

  let tokenSchedule: TokenSchedule;
  let tokenMinter: TokenMinter;
  let governanceToken: BFXN;
  let stakedToken: XbFXN;
  let xbFXNGauge: Gauge;

  let token: MockERC20;
  let gauge: Gauge;

  const INIT_SUPPLY = ethers.parseEther("122000000"); // 122M tokens
  const INIT_RATE = ethers.parseEther("0.247336377473363774"); // 0.247336377473363774 tokens per second
  const RATE_REDUCTION_COEFFICIENT = 1111111111111111111n; // 10/9 * 1e18

  beforeEach(async () => {
    [admin, distributor] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20", admin);
    token = await MockERC20.deploy("Mock Token", "MTK", 18);

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
    const xbFXNGaugeProxy = await TransparentUpgradeableProxy.deploy(
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
    await proxyAdmin.upgrade(xbFXNGaugeProxy.getAddress(), GaugeImplementation.getAddress());

    const StakedToken = await ethers.getContractFactory("xbFXN", admin);
    const StakedTokenImplementation = await StakedToken.deploy(
      GovernanceTokenProxy.getAddress(),
      xbFXNGaugeProxy.getAddress()
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
    xbFXNGauge = (await ethers.getContractAt("Gauge", await xbFXNGaugeProxy.getAddress())) as any as Gauge;
    gauge = (await ethers.getContractAt("Gauge", await GaugeProxy.getAddress())) as any as Gauge;
    stakedToken = (await ethers.getContractAt("xbFXN", await StakedTokenProxy.getAddress())) as any as XbFXN;

    await governanceToken.initialize("Governance Token", "GOV");
    await tokenMinter.initialize(INIT_SUPPLY, INIT_RATE, RATE_REDUCTION_COEFFICIENT);
    await tokenSchedule.initialize();
    await stakedToken.initialize("Staked Token", "STK");
    await xbFXNGauge.initialize(stakedToken.getAddress());
    await gauge.initialize(token.getAddress());

    // Grant roles
    await tokenMinter.grantRole(await tokenMinter.MINTER_ROLE(), tokenSchedule.getAddress());
    await tokenSchedule.grantRole(await tokenSchedule.DISTRIBUTOR_ROLE(), distributor.address);
    await stakedToken.grantRole(await stakedToken.DISTRIBUTOR_ROLE(), distributor.address);
    await xbFXNGauge.grantRole(await xbFXNGauge.REWARD_MANAGER_ROLE(), admin.address);
    await xbFXNGauge.registerRewardToken(stakedToken.getAddress(), stakedToken.getAddress());
    await gauge.grantRole(await gauge.REWARD_MANAGER_ROLE(), admin.address);
    await gauge.registerRewardToken(governanceToken.getAddress(), distributor.getAddress());
  });

  describe("initialize", () => {
    it("should initialize successfully", async () => {
      expect(await gauge.name()).to.equal("Mock Token Gauge");
      expect(await gauge.symbol()).to.equal("MTK-gauge");
      expect(await gauge.bFXN()).to.equal(await governanceToken.getAddress());
      expect(await gauge.xbFXN()).to.equal(await stakedToken.getAddress());
      expect(await gauge.stakingToken()).to.equal(await token.getAddress());
      expect(await gauge.hasRole(await gauge.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
    });
  });

  describe("deposit", () => {
    const depositAmount = ethers.parseEther("100");
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;
    let user3: HardhatEthersSigner;

    beforeEach(async () => {
      [admin, distributor, user1, user2, user3] = await ethers.getSigners();

      // Mint tokens to users
      await token.mint(user1.address, depositAmount * 2n);
      await token.mint(user2.address, depositAmount * 2n);
      await token.mint(user3.address, depositAmount * 2n);

      // Approve gauge for all users
      await token.connect(user1).approve(gauge.getAddress(), depositAmount * 2n);
      await token.connect(user2).approve(gauge.getAddress(), depositAmount * 2n);
      await token.connect(user3).approve(gauge.getAddress(), depositAmount * 2n);
    });

    it("should deposit successfully", async () => {
      await expect(gauge.connect(user1)["deposit(uint256)"](depositAmount))
        .to.emit(gauge, "Deposit")
        .withArgs(user1.address, user1.address, depositAmount);

      expect(await gauge.balanceOf(user1.address)).to.equal(depositAmount);
      expect(await token.balanceOf(gauge.getAddress())).to.equal(depositAmount);
    });

    it("should deposit to different receiver", async () => {
      await expect(gauge.connect(user1)["deposit(uint256,address)"](depositAmount, user2.address))
        .to.emit(gauge, "Deposit")
        .withArgs(user1.address, user2.address, depositAmount);

      expect(await gauge.balanceOf(user2.address)).to.equal(depositAmount);
      expect(await token.balanceOf(gauge.getAddress())).to.equal(depositAmount);
    });

    it("should handle multiple deposits from multiple users", async () => {
      // First deposit from user1
      await gauge.connect(user1)["deposit(uint256)"](depositAmount);
      expect(await gauge.balanceOf(user1.address)).to.equal(depositAmount);

      // Second deposit from user2
      await gauge.connect(user2)["deposit(uint256)"](depositAmount);
      expect(await gauge.balanceOf(user2.address)).to.equal(depositAmount);

      // Third deposit from user3
      await gauge.connect(user3)["deposit(uint256)"](depositAmount);
      expect(await gauge.balanceOf(user3.address)).to.equal(depositAmount);

      // Additional deposit from user1
      await gauge.connect(user1)["deposit(uint256)"](depositAmount);
      expect(await gauge.balanceOf(user1.address)).to.equal(depositAmount * 2n);

      expect(await token.balanceOf(gauge.getAddress())).to.equal(depositAmount * 4n);
    });

    it("should revert when depositing zero amount", async () => {
      await expect(gauge.connect(user1)["deposit(uint256)"](0)).to.be.revertedWithCustomError(
        gauge,
        "DepositZeroAmount"
      );
    });
  });

  describe("withdraw", () => {
    const depositAmount = ethers.parseEther("100");
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;
    let user3: HardhatEthersSigner;

    beforeEach(async () => {
      [admin, distributor, user1, user2, user3] = await ethers.getSigners();

      // Mint tokens to users
      await token.mint(user1.address, depositAmount * 2n);
      await token.mint(user2.address, depositAmount * 2n);
      await token.mint(user3.address, depositAmount * 2n);

      // Approve gauge for all users
      await token.connect(user1).approve(gauge.getAddress(), depositAmount * 2n);
      await token.connect(user2).approve(gauge.getAddress(), depositAmount * 2n);
      await token.connect(user3).approve(gauge.getAddress(), depositAmount * 2n);

      // Deposit tokens for all users
      await gauge.connect(user1)["deposit(uint256)"](depositAmount);
      await gauge.connect(user2)["deposit(uint256)"](depositAmount);
      await gauge.connect(user3)["deposit(uint256)"](depositAmount);
    });

    it("should withdraw successfully", async () => {
      await expect(gauge.connect(user1)["withdraw(uint256)"](depositAmount))
        .to.emit(gauge, "Withdraw")
        .withArgs(user1.address, user1.address, depositAmount);

      expect(await gauge.balanceOf(user1.address)).to.equal(0);
      expect(await token.balanceOf(user1.address)).to.equal(depositAmount * 2n);
    });

    it("should withdraw to different receiver", async () => {
      await expect(gauge.connect(user1)["withdraw(uint256,address)"](depositAmount, user2.address))
        .to.emit(gauge, "Withdraw")
        .withArgs(user1.address, user2.address, depositAmount);

      expect(await gauge.balanceOf(user1.address)).to.equal(0);
      expect(await token.balanceOf(user2.address)).to.equal(depositAmount * 2n);
    });

    it("should handle multiple withdrawals from multiple users", async () => {
      // First withdrawal from user1
      await gauge.connect(user1)["withdraw(uint256)"](depositAmount);
      expect(await gauge.balanceOf(user1.address)).to.equal(0);
      expect(await token.balanceOf(user1.address)).to.equal(depositAmount * 2n);

      // Second withdrawal from user2
      await gauge.connect(user2)["withdraw(uint256)"](depositAmount);
      expect(await gauge.balanceOf(user2.address)).to.equal(0);
      expect(await token.balanceOf(user2.address)).to.equal(depositAmount * 2n);

      // Third withdrawal from user3
      await gauge.connect(user3)["withdraw(uint256)"](depositAmount);
      expect(await gauge.balanceOf(user3.address)).to.equal(0);
      expect(await token.balanceOf(user3.address)).to.equal(depositAmount * 2n);

      expect(await token.balanceOf(gauge.getAddress())).to.equal(0);
    });

    it("should withdraw max amount", async () => {
      await expect(gauge.connect(user1)["withdraw(uint256)"](ethers.MaxUint256))
        .to.emit(gauge, "Withdraw")
        .withArgs(user1.address, user1.address, depositAmount);

      expect(await gauge.balanceOf(user1.address)).to.equal(0);
      expect(await token.balanceOf(user1.address)).to.equal(depositAmount * 2n);
    });

    it("should revert when withdrawing zero amount", async () => {
      await expect(gauge.connect(user1)["withdraw(uint256)"](0)).to.be.revertedWithCustomError(
        gauge,
        "WithdrawZeroAmount"
      );
    });

    it("should revert when withdrawing more than balance", async () => {
      await expect(gauge.connect(user1)["withdraw(uint256)"](depositAmount * 2n)).to.be.revertedWithCustomError(
        gauge,
        "ERC20InsufficientBalance"
      );
    });
  });

  describe("claim, receive xbFXN", () => {
    const depositAmount = ethers.parseEther("100");
    const rewardAmount = ethers.parseEther("10");
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;
    let user3: HardhatEthersSigner;

    beforeEach(async () => {
      [admin, distributor, user1, user2, user3] = await ethers.getSigners();

      // Mint tokens to users
      await token.mint(user1.address, depositAmount * 2n);
      await token.mint(user2.address, depositAmount * 2n);
      await token.mint(user3.address, depositAmount * 2n);

      // Approve gauge for all users
      await token.connect(user1).approve(gauge.getAddress(), depositAmount * 2n);
      await token.connect(user2).approve(gauge.getAddress(), depositAmount * 2n);
      await token.connect(user3).approve(gauge.getAddress(), depositAmount * 2n);

      // Deposit tokens for all users
      await gauge.connect(user1)["deposit(uint256)"](depositAmount);
      await gauge.connect(user2)["deposit(uint256)"](depositAmount);
      await gauge.connect(user3)["deposit(uint256)"](depositAmount);

      // Distribute rewards
      await governanceToken.transfer(distributor.address, rewardAmount * 3n);
      await governanceToken.connect(distributor).approve(gauge.getAddress(), rewardAmount * 3n);
      await gauge.connect(distributor).depositReward(governanceToken.getAddress(), rewardAmount * 3n);
    });

    it("should claim rewards successfully", async () => {
      const claimed = 9999999999999878400n;
      // Move time forward to accumulate rewards
      await ethers.provider.send("evm_increaseTime", [7 * 86400]); // 7 days
      await ethers.provider.send("evm_mine");

      await expect(gauge.connect(user1)["claim(address)"](user1.address))
        .to.emit(gauge, "Claim")
        .withArgs(user1.address, await stakedToken.getAddress(), user1.address, claimed);

      expect(await stakedToken.balanceOf(user1.address)).to.equal(claimed);
    });

    it("should claim rewards to different receiver", async () => {
      const claimed = 9999999999999878400n;
      // Move time forward to accumulate rewards
      await ethers.provider.send("evm_increaseTime", [7 * 86400]); // 7 days
      await ethers.provider.send("evm_mine");

      await expect(gauge.connect(user1)["claim(address,address)"](user1.address, user2.address))
        .to.emit(gauge, "Claim")
        .withArgs(user1.address, stakedToken.getAddress(), user2.address, claimed);

      expect(await stakedToken.balanceOf(user2.address)).to.equal(claimed);
    });

    it("should handle multiple claims from multiple users", async () => {
      const claimed = 9999999999999878400n;
      // Move time forward to accumulate rewards
      await ethers.provider.send("evm_increaseTime", [7 * 86400]); // 7 days
      await ethers.provider.send("evm_mine");

      // First claim from user1
      await gauge.connect(user1)["claim(address)"](user1.address);
      expect(await stakedToken.balanceOf(user1.address)).to.equal(claimed);

      // Second claim from user2
      await gauge.connect(user2)["claim(address)"](user2.address);
      expect(await stakedToken.balanceOf(user2.address)).to.equal(claimed);

      // Third claim from user3
      await gauge.connect(user3)["claim(address)"](user3.address);
      expect(await stakedToken.balanceOf(user3.address)).to.equal(claimed);
    });
  });

  describe("claimAndExit, receive bFXN", () => {
    const depositAmount = ethers.parseEther("100");
    const rewardAmount = ethers.parseEther("10");
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;
    let user3: HardhatEthersSigner;

    beforeEach(async () => {
      [admin, distributor, user1, user2, user3] = await ethers.getSigners();

      // Mint tokens to users
      await token.mint(user1.address, depositAmount * 2n);
      await token.mint(user2.address, depositAmount * 2n);
      await token.mint(user3.address, depositAmount * 2n);

      // Approve gauge for all users
      await token.connect(user1).approve(gauge.getAddress(), depositAmount * 2n);
      await token.connect(user2).approve(gauge.getAddress(), depositAmount * 2n);
      await token.connect(user3).approve(gauge.getAddress(), depositAmount * 2n);

      // Deposit tokens for all users
      await gauge.connect(user1)["deposit(uint256)"](depositAmount);
      await gauge.connect(user2)["deposit(uint256)"](depositAmount);
      await gauge.connect(user3)["deposit(uint256)"](depositAmount);

      // Distribute rewards
      await governanceToken.transfer(distributor.address, rewardAmount * 3n);
      await governanceToken.connect(distributor).approve(gauge.getAddress(), rewardAmount * 3n);
      await gauge.connect(distributor).depositReward(governanceToken.getAddress(), rewardAmount * 3n);
    });

    it("should claim rewards successfully", async () => {
      const claimed = 9999999999999878400n / 2n;
      // Move time forward to accumulate rewards
      await ethers.provider.send("evm_increaseTime", [7 * 86400]); // 7 days
      await ethers.provider.send("evm_mine");

      await expect(gauge.connect(user1).claimAndExit(user1.address))
        .to.emit(gauge, "Claim")
        .withArgs(user1.address, await governanceToken.getAddress(), user1.address, claimed);

      expect(await governanceToken.balanceOf(user1.address)).to.equal(claimed);
    });

    it("should handle multiple claims from multiple users", async () => {
      const claimed = 9999999999999878400n / 2n;
      // Move time forward to accumulate rewards
      await ethers.provider.send("evm_increaseTime", [7 * 86400]); // 7 days
      await ethers.provider.send("evm_mine");

      // First claim from user1
      await gauge.connect(user1).claimAndExit(user1.address);
      expect(await governanceToken.balanceOf(user1.address)).to.equal(claimed);

      // Second claim from user2
      await gauge.connect(user2).claimAndExit(user2.address);
      expect(await governanceToken.balanceOf(user2.address)).to.equal(claimed);

      // Third claim from user3
      await gauge.connect(user3).claimAndExit(user3.address);
      expect(await governanceToken.balanceOf(user3.address)).to.equal(claimed);
    });
  });
});
