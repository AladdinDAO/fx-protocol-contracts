import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ZeroAddress, ZeroHash, id } from "ethers";
import { ethers } from "hardhat";

import { MockERC20, ReservePool } from "@/types/index";

describe("ReservePool.spec", async () => {
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let manager: HardhatEthersSigner;

  let token: MockERC20;
  let pool: ReservePool;

  beforeEach(async () => {
    [deployer, admin, manager] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
    token = await MockERC20.deploy("src", "src", 18);

    const ReservePool = await ethers.getContractFactory("ReservePool", deployer);
    pool = await ReservePool.deploy(admin.address, manager.address);
  });

  context("constructor", async () => {
    it("should initialize correctly", async () => {
      expect(await pool.poolManager()).to.eq(manager.address);
    });
  });

  context("auth", async () => {
    context("#withdrawFund", async () => {
      it("should revert when caller is not admin", async () => {
        await expect(pool.connect(deployer).withdrawFund(ZeroAddress, 0n, deployer.address))
          .to.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, ZeroHash);
      });

      it("should succeed to withdraw ETH", async () => {
        await deployer.sendTransaction({ to: await pool.getAddress(), value: ethers.parseEther("1") });
        expect(await ethers.provider.getBalance(pool.getAddress())).to.eq(ethers.parseEther("1"));
        const before = await ethers.provider.getBalance(deployer.address);
        await pool.connect(admin).withdrawFund(ZeroAddress, ethers.parseEther("1"), deployer.address);
        const after = await ethers.provider.getBalance(deployer.address);
        expect(await ethers.provider.getBalance(pool.getAddress())).to.eq(0n);
        expect(after - before).to.eq(ethers.parseEther("1"));
      });

      it("should succeed to withdraw ERC20", async () => {
        await token.mint(pool.getAddress(), ethers.parseEther("1"));
        expect(await token.balanceOf(pool.getAddress())).to.eq(ethers.parseEther("1"));
        const before = await token.balanceOf(deployer.address);
        await pool.connect(admin).withdrawFund(token.getAddress(), ethers.parseEther("1"), deployer.address);
        const after = await token.balanceOf(deployer.address);
        expect(await token.balanceOf(pool.getAddress())).to.eq(0n);
        expect(after - before).to.eq(ethers.parseEther("1"));
      });
    });
  });

  context("#requestBonus", async () => {
    it("should revert when caller is not manager", async () => {
      await expect(pool.connect(deployer).requestBonus(ZeroAddress, ZeroAddress, 0n)).to.revertedWithCustomError(
        pool,
        "ErrorCallerNotPoolManager"
      );
    });

    it("should succeed when balance enough", async () => {
      await token.mint(pool.getAddress(), ethers.parseEther("100000"));
      expect(await token.balanceOf(deployer.address)).to.eq(0n);
      expect(await token.balanceOf(pool.getAddress())).to.eq(ethers.parseEther("100000"));
      await expect(pool.connect(manager).requestBonus(token.getAddress(), deployer.address, ethers.parseEther("1")))
        .to.emit(pool, "RequestBonus")
        .withArgs(await token.getAddress(), deployer.address, ethers.parseEther("1"));
      expect(await token.balanceOf(deployer.address)).to.eq(ethers.parseEther("1"));
      expect(await token.balanceOf(pool.getAddress())).to.eq(ethers.parseEther("99999"));
    });

    it("should succeed when balance not enough", async () => {
      await token.mint(pool.getAddress(), ethers.parseEther("0.04"));
      expect(await token.balanceOf(deployer.address)).to.eq(0n);
      expect(await token.balanceOf(pool.getAddress())).to.eq(ethers.parseEther("0.04"));
      await expect(pool.connect(manager).requestBonus(token.getAddress(), deployer.address, ethers.parseEther("1")))
        .to.emit(pool, "RequestBonus")
        .withArgs(await token.getAddress(), deployer.address, ethers.parseEther("0.04"));
      expect(await token.balanceOf(deployer.address)).to.eq(ethers.parseEther("0.04"));
      expect(await token.balanceOf(pool.getAddress())).to.eq(0n);
    });
  });
});
