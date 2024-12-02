/* eslint-disable camelcase */
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { id, ZeroAddress, ZeroHash } from "ethers";
import { ethers } from "hardhat";

import { MockERC20, GaugeRewarder, MockMultiPathConverter, MockMultipleRewardDistributor } from "@/types/index";

describe("GaugeRewarder.spec", async () => {
  let deployer: HardhatEthersSigner;
  let signer: HardhatEthersSigner;

  let mockGauge: MockMultipleRewardDistributor;
  let mockConverter: MockMultiPathConverter;

  let token0: MockERC20;
  let token1: MockERC20;
  let rewarder: GaugeRewarder;

  beforeEach(async () => {
    [deployer, signer] = await ethers.getSigners();

    const MockMultipleRewardDistributor = await ethers.getContractFactory("MockMultipleRewardDistributor", deployer);
    const MockMultiPathConverter = await ethers.getContractFactory("MockMultiPathConverter", deployer);
    const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
    const GaugeRewarder = await ethers.getContractFactory("GaugeRewarder", deployer);

    token0 = await MockERC20.deploy("X", "Y", 18);
    token1 = await MockERC20.deploy("Z", "T", 18);
    mockConverter = await MockMultiPathConverter.deploy();
    mockGauge = await MockMultipleRewardDistributor.deploy();
    await mockGauge.initialize();

    rewarder = await GaugeRewarder.deploy(mockGauge.getAddress());
  });

  context("constructor", async () => {
    it("should succeed", async () => {
      expect(await rewarder.gauge()).to.eq(await mockGauge.getAddress());
      expect(await rewarder.PERMISSIONED_TRADER_ROLE()).to.eq(id("PERMISSIONED_TRADER_ROLE"));
      expect(await rewarder.PERMISSIONED_ROUTER_ROLE()).to.eq(id("PERMISSIONED_ROUTER_ROLE"));
    });
  });

  context("withdraw", async () => {
    it("should revert, when caller not admin", async () => {
      await expect(rewarder.connect(signer).withdraw(ZeroAddress, ZeroAddress))
        .to.revertedWithCustomError(rewarder, "AccessControlUnauthorizedAccount")
        .withArgs(signer.address, ZeroHash);
    });

    it("should succeed", async () => {
      await token0.mint(rewarder.getAddress(), ethers.parseEther("100"));
      expect(await token0.balanceOf(rewarder.getAddress())).to.eq(ethers.parseEther("100"));
      expect(await token0.balanceOf(signer.getAddress())).to.eq(0n);
      await rewarder.connect(deployer).withdraw(token0.getAddress(), signer.address);
      expect(await token0.balanceOf(rewarder.getAddress())).to.eq(0n);
      expect(await token0.balanceOf(signer.getAddress())).to.eq(ethers.parseEther("100"));
    });
  });

  context("swapAndDistribute", async () => {
    it("should revert, when caller not PERMISSIONED_TRADER_ROLE", async () => {
      await expect(
        rewarder.connect(signer).swapAndDistribute(token0.getAddress(), token1.getAddress(), {
          router: ZeroAddress,
          data: "0x",
          minOut: 0n,
        })
      )
        .to.revertedWithCustomError(rewarder, "AccessControlUnauthorizedAccount")
        .withArgs(signer.address, id("PERMISSIONED_TRADER_ROLE"));
    });

    it("should revert, when router not PERMISSIONED_ROUTER_ROLE", async () => {
      await rewarder.grantRole(id("PERMISSIONED_TRADER_ROLE"), signer.address);
      await expect(
        rewarder.connect(signer).swapAndDistribute(token0.getAddress(), token1.getAddress(), {
          router: await mockConverter.getAddress(),
          data: "0x",
          minOut: 0n,
        })
      )
        .to.revertedWithCustomError(rewarder, "AccessControlUnauthorizedAccount")
        .withArgs(await mockConverter.getAddress(), id("PERMISSIONED_ROUTER_ROLE"));
    });

    it("should succeed, when target = source", async () => {
      await mockGauge.grantRole(id("REWARD_MANAGER_ROLE"), deployer.address);
      await mockGauge.registerRewardToken(token0.getAddress(), rewarder.getAddress());
      await rewarder.grantRole(id("PERMISSIONED_TRADER_ROLE"), signer.address);
      await token0.mint(rewarder.getAddress(), ethers.parseEther("1"));
      expect(await token0.balanceOf(rewarder.getAddress())).to.eq(ethers.parseEther("1"));
      expect(await token0.balanceOf(mockGauge.getAddress())).to.eq(0n);
      await rewarder.connect(signer).swapAndDistribute(token0.getAddress(), token0.getAddress(), {
        router: ZeroAddress,
        data: "0x",
        minOut: 0n,
      });
      expect(await token0.balanceOf(rewarder.getAddress())).to.eq(0n);
      expect(await token0.balanceOf(mockGauge.getAddress())).to.eq(ethers.parseEther("1"));
    });

    it("should succeed, when target != source", async () => {
      await mockGauge.grantRole(id("REWARD_MANAGER_ROLE"), deployer.address);
      await mockGauge.registerRewardToken(token1.getAddress(), rewarder.getAddress());
      await rewarder.grantRole(id("PERMISSIONED_TRADER_ROLE"), signer.address);
      await rewarder.grantRole(id("PERMISSIONED_ROUTER_ROLE"), await mockConverter.getAddress());
      await token0.mint(rewarder.getAddress(), ethers.parseEther("1"));
      await mockConverter.setTokenOut(token1.getAddress(), ethers.parseEther("10"));
      await token1.mint(mockConverter.getAddress(), ethers.parseEther("10"));

      expect(await token0.balanceOf(rewarder.getAddress())).to.eq(ethers.parseEther("1"));
      expect(await token1.balanceOf(mockGauge.getAddress())).to.eq(0n);
      await expect(
        rewarder.connect(signer).swapAndDistribute(token0.getAddress(), token1.getAddress(), {
          router: await mockConverter.getAddress(),
          data: mockConverter.interface.encodeFunctionData("convert", [
            await token0.getAddress(),
            ethers.parseEther("1"),
            0n,
            [],
          ]),
          minOut: ethers.parseEther("10") + 1n,
        })
      ).to.revertedWithCustomError(rewarder, "InsufficientOutputToken");
      await rewarder.connect(signer).swapAndDistribute(token0.getAddress(), token1.getAddress(), {
        router: await mockConverter.getAddress(),
        data: mockConverter.interface.encodeFunctionData("convert", [
          await token0.getAddress(),
          ethers.parseEther("1"),
          0n,
          [],
        ]),
        minOut: ethers.parseEther("10"),
      });
      expect(await token0.balanceOf(rewarder.getAddress())).to.eq(0n);
      expect(await token1.balanceOf(mockGauge.getAddress())).to.eq(ethers.parseEther("10"));
    });
  });
});
