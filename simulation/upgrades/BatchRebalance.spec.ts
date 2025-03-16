import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  AaveFundingPool,
  Diamond,
  FxUSDRegeneracy,
  FxUSDBasePool,
  FxUSDBasePool__factory,
  MarketV2,
  MockERC20,
  MultiPathConverter,
  PegKeeper,
  PegKeeper__factory,
  PoolManager,
  PoolManager__factory,
  ProxyAdmin,
  ReservePool,
  GaugeRewarder,
  StETHPriceOracle,
  DiamondCutFacet__factory,
  DiamondLoupeFacet__factory,
  OwnershipFacet__factory,
  RouterManagementFacet__factory,
  FlashLoanCallbackFacet__factory,
  PositionOperateFlashLoanFacet__factory,
  MigrateFacet__factory,
} from "@/types/index";

import { forkNetworkAndUnlockAccounts, mockETHBalance, unlockAccounts } from "@/test/utils";
import { Addresses } from "@/utils/address";
import {
  ChainlinkPriceFeed,
  encodeChainlinkPriceFeed,
  encodeSpotPriceSources,
  EthereumTokens,
  MULTI_PATH_CONVERTER_ROUTES,
  SpotPriceEncodings,
} from "@/utils/index";
import { MaxUint256 } from "ethers";

const FORK_HEIGHT = 21949910;
const FORK_URL = process.env.MAINNET_FORK_RPC || "";
const OWNER = "0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF";
const USDC_HOLDER = "0xe9172Daf64b05B26eb18f07aC8d6D723aCB48f99";
const DEPLOYER = "0x1000000000000000000000000000000000000001";

describe("BatchRebalance.spec", async () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;

  let proxyAdmin: ProxyAdmin;

  let fxUSD: FxUSDRegeneracy;
  let pegKeeper: PegKeeper;
  let poolManager: PoolManager;
  let fxBASE: FxUSDBasePool;
  let pool: AaveFundingPool;

  beforeEach(async () => {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [DEPLOYER, OWNER, USDC_HOLDER]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    await mockETHBalance(OWNER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);
    owner = await ethers.getSigner(OWNER);

    proxyAdmin = await ethers.getContractAt("ProxyAdmin", "0x9B54B7703551D9d0ced177A78367560a8B2eDDA4", owner);

    fxUSD = await ethers.getContractAt("FxUSDRegeneracy", "0x085780639CC2cACd35E474e71f4d000e2405d8f6", owner);
    pool = await ethers.getContractAt("AaveFundingPool", "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8", owner);
    poolManager = await ethers.getContractAt("PoolManager", "0x250893CA4Ba5d05626C785e8da758026928FCD24", owner);
    pegKeeper = await ethers.getContractAt("PegKeeper", "0x50562fe7e870420F5AAe480B7F94EB4ace2fcd70", owner);
    fxBASE = await ethers.getContractAt("FxUSDBasePool", "0x65C9A641afCEB9C0E6034e558A319488FA0FA3be", owner);

    const PoolManager = await ethers.getContractFactory("PoolManager", deployer);
    const FxUSDBasePool = await ethers.getContractFactory("FxUSDBasePool", deployer);
    const AaveFundingPool = await ethers.getContractFactory("AaveFundingPool", deployer);

    // deploy and upgrade PoolManager
    const PoolManagerImpl = await PoolManager.deploy(fxUSD.getAddress(), fxBASE.getAddress(), pegKeeper.getAddress());
    await proxyAdmin.upgrade(poolManager.getAddress(), PoolManagerImpl.getAddress());

    // deploy and upgrade FxUSDBasePool
    const FxUSDBasePoolImpl = await FxUSDBasePool.deploy(
      poolManager.getAddress(),
      pegKeeper.getAddress(),
      fxUSD.getAddress(),
      EthereumTokens.USDC.address,
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["USDC-USD"].feed,
        ChainlinkPriceFeed.ethereum["USDC-USD"].scale,
        ChainlinkPriceFeed.ethereum["USDC-USD"].heartbeat
      )
    );
    await proxyAdmin.upgrade(fxBASE.getAddress(), FxUSDBasePoolImpl.getAddress());

    // deploy and upgrade AaveFundingPool
    const AaveFundingPoolImpl = await AaveFundingPool.deploy(
      poolManager.getAddress(),
      "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      EthereumTokens.USDC.address
    );
    await proxyAdmin.upgrade(pool.getAddress(), AaveFundingPoolImpl.getAddress());
  });

  it.skip("should succeed to liquidate", async() => {
    await mockETHBalance(USDC_HOLDER, ethers.parseEther("100"));
    const signer = await ethers.getSigner(USDC_HOLDER);
    const usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, signer);
    console.log(await pool.getDebtAndCollateralIndex());
    await usdc.approve(fxBASE.getAddress(), MaxUint256);
    await fxBASE.connect(signer).liquidate(pool.getAddress(), usdc.getAddress(), 10n ** 18n, 0);
    console.log(await pool.getDebtAndCollateralIndex());
  });

  it.skip("should succeed to rebalance", async() => {
    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle", deployer);
    const oracle = await MockPriceOracle.deploy(0, 0, 0);
    await oracle.setPrices(ethers.parseEther("2000"), ethers.parseEther("2000"), ethers.parseEther("2000"));
    await pool.updatePriceOracle(oracle.getAddress());

    await mockETHBalance(USDC_HOLDER, ethers.parseEther("100"));
    const signer = await ethers.getSigner(USDC_HOLDER);
    const usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, signer);
    await usdc.approve(fxBASE.getAddress(), MaxUint256);
    await fxBASE.connect(signer)["rebalance(address,address,uint256,uint256)"](pool.getAddress(), usdc.getAddress(), 10n ** 18n, 0);
  });
});
