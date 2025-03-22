import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { TokenSchedule, TokenMinter, BFXN, XbFXN, Gauge, AbFXN } from "@/types/index";
import { ZeroHash } from "ethers";

describe("abFXN.spec", async () => {
  let admin: HardhatEthersSigner;
  let distributor: HardhatEthersSigner;

  let tokenSchedule: TokenSchedule;
  let tokenMinter: TokenMinter;
  let governanceToken: BFXN;
  let stakedToken: XbFXN;
  let gauge: Gauge;
  let abFXN: AbFXN;

  const DAY_SECONDS = 86400;
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
    const AbFXNProxy = await TransparentUpgradeableProxy.deploy(proxyAdmin.getAddress(), proxyAdmin.getAddress(), "0x");

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
    abFXN = (await ethers.getContractAt("abFXN", await AbFXNProxy.getAddress())) as any as AbFXN;

    await governanceToken.initialize("Governance Token", "GOV");
    await tokenMinter.initialize(INIT_SUPPLY, INIT_RATE, RATE_REDUCTION_COEFFICIENT);
    await tokenSchedule.initialize();
    await stakedToken.initialize("Staked Token", "xbFXN");
    await gauge.initialize(stakedToken.getAddress());

    const AbFXN = await ethers.getContractFactory("abFXN", admin);
    const AbFXNImplementation = await AbFXN.deploy(GaugeProxy.getAddress());
    await proxyAdmin.upgrade(AbFXNProxy.getAddress(), AbFXNImplementation.getAddress());
    await abFXN.initialize("A Staked Token", "abFXN");

    // Grant roles
    await tokenMinter.grantRole(await tokenMinter.MINTER_ROLE(), tokenSchedule.getAddress());
    await tokenSchedule.grantRole(await tokenSchedule.DISTRIBUTOR_ROLE(), distributor.address);
    await stakedToken.grantRole(await stakedToken.DISTRIBUTOR_ROLE(), distributor.address);
    await gauge.grantRole(await gauge.REWARD_MANAGER_ROLE(), admin.address);
    await gauge.registerRewardToken(stakedToken.getAddress(), stakedToken.getAddress());
  });

  describe("initialize", () => {
    it("should initialize correctly", async () => {
      expect(await abFXN.name()).to.equal("A Staked Token");
      expect(await abFXN.symbol()).to.equal("abFXN");
      expect(await abFXN.asset()).to.equal(await stakedToken.getAddress());
      expect(await abFXN.totalAssets()).to.equal(0n);
      expect(await abFXN.totalSupply()).to.equal(0n);
      expect(await abFXN.hasRole(ZeroHash, admin.address)).to.eq(true);

      await expect(abFXN.initialize("A Staked Token", "abFXN")).to.be.revertedWithCustomError(
        abFXN,
        "InvalidInitialization"
      );
    });
  });

  describe("deposit and redeem", async () => {
    const depositAmount = ethers.parseEther("1000");
    beforeEach(async () => {
      // Mint some bFXN tokens to distributor and stake them
      await governanceToken.connect(admin).transfer(distributor.address, depositAmount * 100n);
      await governanceToken.connect(distributor).approve(stakedToken.getAddress(), depositAmount * 100n);
      await stakedToken.connect(distributor).stake(depositAmount * 100n, distributor.address);
    });

    it("should deposit and mint shares correctly", async () => {
      // Setup initial deposit
      await stakedToken.connect(distributor).approve(abFXN.getAddress(), depositAmount);
      await abFXN.connect(distributor).deposit(depositAmount, distributor.address);

      // Check balances
      expect(await abFXN.balanceOf(distributor.address)).to.equal(depositAmount);
      expect(await abFXN.totalAssets()).to.equal(depositAmount);
      expect(await stakedToken.balanceOf(abFXN.getAddress())).to.equal(0n); // All assets should be in gauge
      expect(await gauge.balanceOf(abFXN.getAddress())).to.equal(depositAmount);
    });

    it("should redeem shares and withdraw assets correctly", async () => {
      // Setup initial deposit
      await stakedToken.connect(distributor).approve(abFXN.getAddress(), depositAmount);
      await abFXN.connect(distributor).deposit(depositAmount, distributor.address);

      // Redeem shares
      const redeemAmount = ethers.parseEther("500");
      const beforeBalance = await stakedToken.balanceOf(distributor.address);
      await abFXN.connect(distributor).redeem(redeemAmount, distributor.address, distributor.address);
      const afterBalance = await stakedToken.balanceOf(distributor.address);

      // Check balances
      expect(await abFXN.balanceOf(distributor.address)).to.equal(depositAmount - redeemAmount);
      expect(await abFXN.totalAssets()).to.equal(depositAmount - redeemAmount);
      expect(afterBalance).to.equal(beforeBalance + redeemAmount);
      expect(await gauge.balanceOf(abFXN.getAddress())).to.equal(depositAmount - redeemAmount);
    });

    it("should handle multiple deposits and withdrawals correctly", async () => {
      // Setup initial deposit
      await stakedToken.connect(distributor).approve(abFXN.getAddress(), depositAmount * 2n);

      // First deposit
      await abFXN.connect(distributor).deposit(depositAmount, distributor.address);
      expect(await abFXN.balanceOf(distributor.address)).to.equal(depositAmount);

      // Second deposit
      await abFXN.connect(distributor).deposit(depositAmount, distributor.address);
      expect(await abFXN.balanceOf(distributor.address)).to.equal(depositAmount * 2n);

      // Partial withdrawal
      const withdrawAmount = ethers.parseEther("500");
      const beforeBalance = await stakedToken.balanceOf(distributor.address);
      await abFXN.connect(distributor).withdraw(withdrawAmount, distributor.address, distributor.address);
      const afterBalance = await stakedToken.balanceOf(distributor.address);

      // Check balances
      expect(await abFXN.balanceOf(distributor.address)).to.equal(depositAmount * 2n - withdrawAmount);
      expect(await stakedToken.balanceOf(abFXN.getAddress())).to.equal(0n);
      expect(await gauge.balanceOf(abFXN.getAddress())).to.equal(depositAmount * 2n - withdrawAmount);
      expect(afterBalance).to.equal(beforeBalance + withdrawAmount);
    });
  });

  describe("harvest", async () => {
    it("should harvest rewards correctly", async () => {
      const depositAmount = ethers.parseEther("1000");

      // Setup initial deposit
      await governanceToken.connect(admin).transfer(distributor.address, depositAmount);
      await governanceToken.connect(distributor).approve(stakedToken.getAddress(), depositAmount);
      await stakedToken.connect(distributor).stake(depositAmount, distributor.address);
      await stakedToken.connect(distributor).approve(abFXN.getAddress(), depositAmount);
      await abFXN.connect(distributor).deposit(depositAmount, distributor.address);

      // exit with penalty
      await governanceToken.connect(admin).approve(stakedToken.getAddress(), ethers.parseEther("1"));
      await stakedToken.connect(admin).stake(ethers.parseEther("1"), admin.address);
      await stakedToken.connect(admin).exit(ethers.parseEther("1"), admin.address);
      const timestamp = await ethers.provider.getBlock("latest").then((block) => block!.timestamp);
      const day = Math.floor(timestamp / DAY_SECONDS) * DAY_SECONDS + DAY_SECONDS;
      const penalty = await stakedToken.exitPenalty(day);
      expect(penalty).to.eq(ethers.parseEther("0.5"));

      // distribute exit penalty
      await ethers.provider.send("evm_setNextBlockTimestamp", [day]);
      await ethers.provider.send("evm_mine");
      const balanceBefore = await stakedToken.balanceOf(gauge.getAddress());
      await stakedToken.connect(distributor).distributeExitPenalty();
      const balanceAfter = await stakedToken.balanceOf(gauge.getAddress());
      expect(balanceAfter).to.equal(balanceBefore + penalty);

      // advance time to accumulate rewards
      await ethers.provider.send("evm_increaseTime", [7 * 86400]);
      await ethers.provider.send("evm_mine");

      // Record initial state
      const initialGaugeBalance = await gauge.balanceOf(abFXN.getAddress());

      // Harvest rewards
      await abFXN.connect(distributor).harvest();

      // Check that rewards were harvested and redeposited
      const finalGaugeBalance = await gauge.balanceOf(abFXN.getAddress());
      expect(finalGaugeBalance).to.be.gt(initialGaugeBalance);

      expect(await abFXN.totalAssets()).to.eq(finalGaugeBalance);
    });
  });
});
