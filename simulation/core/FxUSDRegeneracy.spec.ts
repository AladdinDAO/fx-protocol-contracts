import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  FxUSDRegeneracy,
  FxUSDBasePool,
  FxUSDBasePool__factory,
  MockERC20,
  MultiPathConverter,
  PegKeeper__factory,
  PoolManager__factory,
  ProxyAdmin,
  ReservePool,
  StETHPriceOracle,
} from "@/types/index";

import { forkNetworkAndUnlockAccounts, mockETHBalance, unlockAccounts } from "@/test/utils";
import {
  Addresses,
  ChainlinkPriceFeed,
  encodeChainlinkPriceFeed,
  encodeSpotPriceSources,
  EthereumTokens,
  SpotPriceEncodings,
} from "@/utils/index";
import { ZeroAddress } from "ethers";

const FORK_HEIGHT = 21234850;
const FORK_URL = process.env.MAINNET_FORK_RPC || "";
const PLATFORM = "0x0084C2e1B1823564e597Ff4848a88D61ac63D703";
const OWNER = "0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF";
const DEPLOYER = "0x1000000000000000000000000000000000000001";

describe("FxUSDRegeneracy.spec", async () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;

  let proxyAdmin: ProxyAdmin;

  let fxUSD: FxUSDRegeneracy;
  let usdc: MockERC20;
  let wstETH: MockERC20;
  let sfrxETH: MockERC20;

  let oracle: StETHPriceOracle;

  let reservePool: ReservePool;
  let fxBASE: FxUSDBasePool;

  let converter: MultiPathConverter;

  beforeEach(async () => {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [DEPLOYER, OWNER]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    await mockETHBalance(OWNER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);
    owner = await ethers.getSigner(OWNER);

    const spot = await ethers.getContractAt("ISpotPriceOracle", "0xc2312CaF0De62eC9b4ADC785C79851Cb989C9abc", deployer);
    proxyAdmin = await ethers.getContractAt("ProxyAdmin", "0x9B54B7703551D9d0ced177A78367560a8B2eDDA4", owner);

    fxUSD = await ethers.getContractAt("FxUSDRegeneracy", EthereumTokens.fxUSD.address, deployer);
    usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, deployer);
    wstETH = await ethers.getContractAt("MockERC20", EthereumTokens.wstETH.address, deployer);
    sfrxETH = await ethers.getContractAt("MockERC20", EthereumTokens.sfrxETH.address, deployer);

    const StETHPriceOracle = await ethers.getContractFactory("StETHPriceOracle", deployer);
    oracle = await StETHPriceOracle.deploy(
      spot.getAddress(),
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["ETH-USD"].feed,
        ChainlinkPriceFeed.ethereum["ETH-USD"].scale,
        ChainlinkPriceFeed.ethereum["ETH-USD"].heartbeat
      ),
      Addresses["CRV_SP_ETH/stETH_303"]
    );
    await oracle.updateOnchainSpotEncodings(SpotPriceEncodings["WETH/USDC"], 0);
    await oracle.updateOnchainSpotEncodings(SpotPriceEncodings["stETH/WETH"], 1);
    await oracle.updateOnchainSpotEncodings(encodeSpotPriceSources([]), 2);

    const EmptyContract = await ethers.getContractFactory("EmptyContract", deployer);
    const TransparentUpgradeableProxy = await ethers.getContractFactory("TransparentUpgradeableProxy", deployer);
    const FxUSDRegeneracy = await ethers.getContractFactory("FxUSDRegeneracy", deployer);
    const PegKeeper = await ethers.getContractFactory("PegKeeper", deployer);
    const PoolManager = await ethers.getContractFactory("PoolManager", deployer);
    const FxUSDBasePool = await ethers.getContractFactory("FxUSDBasePool", deployer);
    const ReservePool = await ethers.getContractFactory("ReservePool", deployer);
    const MultiPathConverter = await ethers.getContractFactory("MultiPathConverter", deployer);

    const empty = await EmptyContract.deploy();
    converter = await MultiPathConverter.deploy("0x11C907b3aeDbD863e551c37f21DD3F36b28A6784");

    const PegKeeperProxy = await TransparentUpgradeableProxy.deploy(empty.getAddress(), proxyAdmin.getAddress(), "0x");
    const PoolManagerProxy = await TransparentUpgradeableProxy.deploy(
      empty.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );
    const FxUSDBasePoolProxy = await TransparentUpgradeableProxy.deploy(
      empty.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );

    // deploy ReservePool
    reservePool = await ReservePool.deploy(owner.address, PoolManagerProxy.getAddress());

    // deploy PoolManager
    const PoolManagerImpl = await PoolManager.deploy(
      fxUSD.getAddress(),
      FxUSDBasePoolProxy.getAddress(),
      PegKeeperProxy.getAddress()
    );
    await proxyAdmin.upgradeAndCall(
      PoolManagerProxy.getAddress(),
      PoolManagerImpl.getAddress(),
      PoolManager__factory.createInterface().encodeFunctionData("initialize", [
        owner.address,
        ethers.parseUnits("0.1", 9),
        ethers.parseUnits("0.01", 9),
        ethers.parseUnits("0.0001", 9),
        PLATFORM,
        PLATFORM,
        await reservePool.getAddress(),
      ])
    );

    // deploy FxUSDRegeneracy
    const FxUSDRegeneracyImpl = await FxUSDRegeneracy.deploy(
      PoolManagerProxy.getAddress(),
      usdc.getAddress(),
      PegKeeperProxy.getAddress()
    );
    await proxyAdmin.upgrade(fxUSD.getAddress(), FxUSDRegeneracyImpl.getAddress());
    await fxUSD.initializeV2();

    // deploy FxUSDBasePool
    const FxUSDBasePoolImpl = await FxUSDBasePool.deploy(
      PoolManagerProxy.getAddress(),
      PegKeeperProxy.getAddress(),
      fxUSD.getAddress(),
      usdc.getAddress(),
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["USDC-USD"].feed,
        ChainlinkPriceFeed.ethereum["USDC-USD"].scale,
        ChainlinkPriceFeed.ethereum["USDC-USD"].heartbeat
      )
    );
    await proxyAdmin.upgradeAndCall(
      FxUSDBasePoolProxy.getAddress(),
      FxUSDBasePoolImpl.getAddress(),
      FxUSDBasePool__factory.createInterface().encodeFunctionData("initialize", [
        owner.address,
        "fxUSD Save",
        "fxBASE",
        ethers.parseEther("0.95"),
        0n,
      ])
    );
    fxBASE = await ethers.getContractAt("FxUSDBasePool", await FxUSDBasePoolProxy.getAddress(), owner);

    // deploy PegKeeper
    const PegKeeperImpl = await PegKeeper.deploy(fxBASE.getAddress());
    await proxyAdmin.upgradeAndCall(
      PegKeeperProxy.getAddress(),
      PegKeeperImpl.getAddress(),
      PegKeeper__factory.createInterface().encodeFunctionData("initialize", [
        owner.address,
        await converter.getAddress(),
        Addresses["CRV_SN_USDC/fxUSD_193"],
      ])
    );
  });

  it("should succeed on getMarkets", async () => {
    expect(await fxUSD.getMarkets()).to.deep.eq([await wstETH.getAddress(), await sfrxETH.getAddress()]);
  });

  it("should succeed on getRebalancePools", async () => {
    expect(await fxUSD.getRebalancePools()).to.deep.eq([
      "0x9aD382b028e03977D446635Ba6b8492040F829b7",
      "0x0417CE2934899d7130229CDa39Db456Ff2332685",
      "0xb925F8CAA6BE0BFCd1A7383168D1c932D185A748",
      "0x4a2ab45D27428901E826db4a52Dae00594b68022",
    ]);
  });

  it("should succeed on nav", async () => {
    expect(await fxUSD.nav()).to.eq(10n ** 18n);
  });

  context("wrapFrom", async () => {
    const wrapFrom = async (poolAddr: string, holderAddr: string, amount: bigint) => {
      await unlockAccounts([holderAddr]);
      const holder = await ethers.getSigner(holderAddr);
      await mockETHBalance(holderAddr, ethers.parseEther("100"));

      const pool = await ethers.getContractAt("IFxShareableRebalancePool", poolAddr, deployer);
      const holderBefore = await pool.balanceOf(holder.address);
      const deployerBefore = await fxUSD.balanceOf(deployer.address);
      const supplyBefore = await fxUSD.totalSupply();
      const legacySupplyBefore = await fxUSD.legacyTotalSupply();
      await fxUSD.connect(holder).wrapFrom(pool.getAddress(), amount, deployer.address);
      const holderAfter = await pool.balanceOf(holder.address);
      const deployerAfter = await fxUSD.balanceOf(deployer.address);
      const supplyAfter = await fxUSD.totalSupply();
      const legacySupplyAfter = await fxUSD.legacyTotalSupply();
      expect(deployerAfter - deployerBefore).to.eq(amount);
      expect(supplyAfter - supplyBefore).to.eq(amount);
      expect(legacySupplyAfter - legacySupplyBefore).to.eq(amount);
      expect(holderBefore - holderAfter).to.eq(amount);
    };

    it("should succeed, when wrapFrom from wstETH pool", async () => {
      await wrapFrom(
        "0x9aD382b028e03977D446635Ba6b8492040F829b7",
        "0xb8Aa5d63491c087D40Fee4311A89b1dCd74b0FDb",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when wrapFrom from xstETH pool", async () => {
      await wrapFrom(
        "0x0417CE2934899d7130229CDa39Db456Ff2332685",
        "0xF483De0f306952FA56ef56c1dbBDd2A70737bDd5",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when wrapFrom from sfrxETH pool", async () => {
      await wrapFrom(
        "0xb925F8CAA6BE0BFCd1A7383168D1c932D185A748",
        "0x6859F2e01A32bCC16C2e314A75945e3787D4CeDC",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when wrapFrom from xfrxETH pool", async () => {
      await wrapFrom(
        "0x4a2ab45D27428901E826db4a52Dae00594b68022",
        "0xa9d12e95b35e44A6fDE3A9879E99dd89E06dB5f0",
        ethers.parseEther("100")
      );
    });
  });

  it("should revert, when mint", async () => {
    await expect(fxUSD["mint(address,uint256,address,uint256)"](ZeroAddress, 0n, ZeroAddress, 0n)).to.revertedWith(
      "mint paused"
    );
  });

  it("should revert, when earn", async () => {
    await expect(fxUSD.earn(ZeroAddress, 0n, ZeroAddress)).to.revertedWith("earn paused");
  });

  it("should revert, when mintAndEarn", async () => {
    await expect(fxUSD.mintAndEarn(ZeroAddress, 0, ZeroAddress, 0n)).to.revertedWith("mint and earn paused");
  });

  context("redeem", async () => {
    const redeem = async (holderAddr: string, baseToken: MockERC20, amount: bigint) => {
      await unlockAccounts([holderAddr]);
      await mockETHBalance(holderAddr, ethers.parseEther("100"));
      const holder = await ethers.getSigner(holderAddr);

      const holderBefore = await fxUSD.balanceOf(holder.address);
      const deployerBefore = await baseToken.balanceOf(deployer.address);
      const supplyBefore = await fxUSD.totalSupply();
      const legacySupplyBefore = await fxUSD.legacyTotalSupply();
      await fxUSD.connect(holder).redeem(baseToken.getAddress(), amount, deployer.address, 0n);
      const holderAfter = await fxUSD.balanceOf(holder.address);
      const deployerAfter = await baseToken.balanceOf(deployer.address);
      const supplyAfter = await fxUSD.totalSupply();
      const legacySupplyAfter = await fxUSD.legacyTotalSupply();
      expect(supplyAfter - supplyBefore).to.eq(-amount);
      expect(legacySupplyAfter - legacySupplyBefore).to.eq(-amount);
      expect(holderBefore - holderAfter).to.eq(amount);
      expect(deployerAfter - deployerBefore).to.gt(0n);

      console.log(
        "redeem:",
        `fxUSD[${ethers.formatEther(amount)}]`,
        `${await baseToken.symbol()}[${ethers.formatUnits(deployerAfter - deployerBefore, await baseToken.decimals())}]`
      );
    };

    it("should succeed, when redeem to wstETH", async () => {
      await redeem("0xB1Fb33bF3A036742FFFAa9F96C548AcB0aE6a4bB", wstETH, ethers.parseEther("100"));
    });

    it("should succeed, when redeem to sfrxETH", async () => {
      await redeem("0xB1Fb33bF3A036742FFFAa9F96C548AcB0aE6a4bB", sfrxETH, ethers.parseEther("100"));
    });
  });

  context("redeemFrom", async () => {
    const redeemFrom = async (poolAddr: string, holderAddr: string, amount: bigint) => {
      await unlockAccounts([holderAddr]);
      const holder = await ethers.getSigner(holderAddr);
      await mockETHBalance(holderAddr, ethers.parseEther("100"));

      const pool = await ethers.getContractAt("IFxShareableRebalancePool", poolAddr, deployer);
      const baseToken = await ethers.getContractAt("MockERC20", await pool.baseToken(), deployer);
      const holderBefore = await pool.balanceOf(holder.address);
      const deployerBefore = await baseToken.balanceOf(deployer.address);
      const supplyBefore = await fxUSD.totalSupply();
      const legacySupplyBefore = await fxUSD.legacyTotalSupply();
      await fxUSD.connect(holder).redeemFrom(pool.getAddress(), amount, deployer.address, 0n);
      const holderAfter = await pool.balanceOf(holder.address);
      const deployerAfter = await baseToken.balanceOf(deployer.address);
      const supplyAfter = await fxUSD.totalSupply();
      const legacySupplyAfter = await fxUSD.legacyTotalSupply();
      expect(deployerAfter - deployerBefore).to.gt(0n);
      expect(holderBefore - holderAfter).to.eq(amount);
      expect(supplyAfter - supplyBefore).to.eq(0n);
      expect(legacySupplyAfter - legacySupplyBefore).to.eq(0n);
      console.log(
        "redeemFrom:",
        `fxUSD[${ethers.formatEther(amount)}]`,
        `${await baseToken.symbol()}[${ethers.formatUnits(deployerAfter - deployerBefore, await baseToken.decimals())}]`
      );
    };

    it("should succeed, when redeemFrom from wstETH pool", async () => {
      await redeemFrom(
        "0x9aD382b028e03977D446635Ba6b8492040F829b7",
        "0xb8Aa5d63491c087D40Fee4311A89b1dCd74b0FDb",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when redeemFrom from xstETH pool", async () => {
      await redeemFrom(
        "0x0417CE2934899d7130229CDa39Db456Ff2332685",
        "0xF483De0f306952FA56ef56c1dbBDd2A70737bDd5",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when redeemFrom from sfrxETH pool", async () => {
      await redeemFrom(
        "0xb925F8CAA6BE0BFCd1A7383168D1c932D185A748",
        "0x6859F2e01A32bCC16C2e314A75945e3787D4CeDC",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when redeemFrom from xfrxETH pool", async () => {
      await redeemFrom(
        "0x4a2ab45D27428901E826db4a52Dae00594b68022",
        "0xa9d12e95b35e44A6fDE3A9879E99dd89E06dB5f0",
        ethers.parseEther("100")
      );
    });
  });

  context("autoRedeem", async () => {
    it("should succeed", async () => {
      const holderAddr = "0xB1Fb33bF3A036742FFFAa9F96C548AcB0aE6a4bB";
      await unlockAccounts([holderAddr]);
      await mockETHBalance(holderAddr, ethers.parseEther("100"));
      const holder = await ethers.getSigner(holderAddr);
      const amount = ethers.parseEther("100");

      const holderBefore = await fxUSD.balanceOf(holder.address);
      const deployerWstETHBefore = await wstETH.balanceOf(deployer.address);
      const deployerSfrxETHBefore = await sfrxETH.balanceOf(deployer.address);
      const supplyBefore = await fxUSD.totalSupply();
      const legacySupplyBefore = await fxUSD.legacyTotalSupply();
      await fxUSD.connect(holder).autoRedeem(amount, deployer.address, [0n, 0n]);
      const holderAfter = await fxUSD.balanceOf(holder.address);
      const deployerWstETHAfter = await wstETH.balanceOf(deployer.address);
      const deployerSfrxETHAfter = await sfrxETH.balanceOf(deployer.address);
      const supplyAfter = await fxUSD.totalSupply();
      const legacySupplyAfter = await fxUSD.legacyTotalSupply();
      expect(supplyAfter - supplyBefore).to.eq(-amount);
      expect(legacySupplyAfter - legacySupplyBefore).to.eq(-amount);
      expect(holderBefore - holderAfter).to.eq(amount);
      console.log(
        "autoRedeem:",
        `fxUSD[${ethers.formatEther(amount)}]`,
        `wstETH[${ethers.formatEther(deployerWstETHAfter - deployerWstETHBefore)}]`,
        `sfrxETH[${ethers.formatEther(deployerSfrxETHAfter - deployerSfrxETHBefore)}]`
      );
    });
  });
});
