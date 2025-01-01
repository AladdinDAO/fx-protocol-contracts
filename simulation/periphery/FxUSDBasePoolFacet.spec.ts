import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  Diamond,
  FxUSDRegeneracy,
  FxUSDBasePool,
  FxUSDBasePool__factory,
  MockERC20,
  MultiPathConverter,
  PegKeeper,
  PegKeeper__factory,
  PoolManager,
  PoolManager__factory,
  ProxyAdmin,
  ReservePool,
  StETHPriceOracle,
  DiamondCutFacet__factory,
  DiamondLoupeFacet__factory,
  OwnershipFacet__factory,
  RouterManagementFacet__factory,
  IRateProvider,
  ILiquidityGauge,
  FxUSDBasePoolFacet__factory,
  ILiquidityGauge__factory,
} from "@/types/index";

import { forkNetworkAndUnlockAccounts, mockETHBalance, unlockAccounts } from "@/test/utils";
import { Addresses } from "@/utils/address";
import {
  ChainlinkPriceFeed,
  encodeChainlinkPriceFeed,
  encodeSpotPriceSources,
  EthereumTokens,
  MULTI_PATH_CONVERTER_ROUTES,
  same,
  SpotPriceEncodings,
} from "@/utils/index";
import { Interface, ZeroAddress } from "ethers";

const FORK_HEIGHT = 21234850;
const FORK_URL = process.env.MAINNET_FORK_RPC || "";
const PLATFORM = "0x0084C2e1B1823564e597Ff4848a88D61ac63D703";
const OWNER = "0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF";
const DEPLOYER = "0x1000000000000000000000000000000000000001";

const getAllSignatures = (e: Interface): string[] => {
  const sigs: string[] = [];
  e.forEachFunction((func, _) => {
    sigs.push(func.selector);
  });
  return sigs;
};

describe("FxUSDBasePoolFacet.spec", async () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;

  let proxyAdmin: ProxyAdmin;

  let fxUSD: FxUSDRegeneracy;
  let usdc: MockERC20;
  let wstETH: MockERC20;

  let oracle: StETHPriceOracle;
  let rateProvider: IRateProvider;

  let pegKeeper: PegKeeper;
  let poolManager: PoolManager;
  let reservePool: ReservePool;
  let fxBASE: FxUSDBasePool;
  let gauge: ILiquidityGauge;

  let converter: MultiPathConverter;
  let router: Diamond;

  beforeEach(async () => {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [DEPLOYER, OWNER]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    await mockETHBalance(OWNER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);
    owner = await ethers.getSigner(OWNER);

    const spot = await ethers.getContractAt("ISpotPriceOracle", "0xc2312CaF0De62eC9b4ADC785C79851Cb989C9abc", deployer);
    proxyAdmin = await ethers.getContractAt("ProxyAdmin", "0x9B54B7703551D9d0ced177A78367560a8B2eDDA4", owner);

    rateProvider = await ethers.getContractAt("IRateProvider", "0x81A777c4aB65229d1Bf64DaE4c831bDf628Ccc7f", deployer);
    fxUSD = await ethers.getContractAt("FxUSDRegeneracy", EthereumTokens.fxUSD.address, deployer);
    usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, deployer);
    wstETH = await ethers.getContractAt("MockERC20", EthereumTokens.wstETH.address, deployer);

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
    poolManager = await ethers.getContractAt("PoolManager", await PoolManagerProxy.getAddress(), owner);

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
    pegKeeper = await ethers.getContractAt("PegKeeper", await PegKeeperProxy.getAddress(), owner);

    // deploy gauge
    const FxUSDBasePoolGaugeProxy = await TransparentUpgradeableProxy.deploy(
      "0xF62F458D2F6dd2AD074E715655064d7632e136D6",
      proxyAdmin.getAddress(),
      ILiquidityGauge__factory.createInterface().encodeFunctionData("initialize", [await fxBASE.getAddress()])
    );
    gauge = await ethers.getContractAt("ILiquidityGauge", await FxUSDBasePoolGaugeProxy.getAddress(), deployer);

    // deploy Facets and Diamond
    {
      const Diamond = await ethers.getContractFactory("Diamond", deployer);
      const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet", deployer);
      const DiamondLoupeFacet = await ethers.getContractFactory("DiamondLoupeFacet", deployer);
      const OwnershipFacet = await ethers.getContractFactory("OwnershipFacet", deployer);
      const RouterManagementFacet = await ethers.getContractFactory("RouterManagementFacet", deployer);
      const FxUSDBasePoolFacet = await ethers.getContractFactory("FxUSDBasePoolFacet", deployer);
      const cut = await DiamondCutFacet.deploy();
      const loupe = await DiamondLoupeFacet.deploy();
      const ownership = await OwnershipFacet.deploy();
      const routerManagement = await RouterManagementFacet.deploy();
      const basePool = await FxUSDBasePoolFacet.deploy(
        poolManager.getAddress(),
        fxBASE.getAddress(),
        gauge.getAddress()
      );

      const diamondCuts = [
        {
          facetAddress: await cut.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(DiamondCutFacet__factory.createInterface()),
        },
        {
          facetAddress: await loupe.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(DiamondLoupeFacet__factory.createInterface()),
        },
        {
          facetAddress: await ownership.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(OwnershipFacet__factory.createInterface()),
        },
        {
          facetAddress: await routerManagement.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(RouterManagementFacet__factory.createInterface()),
        },
        {
          facetAddress: await basePool.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(FxUSDBasePoolFacet__factory.createInterface()),
        },
      ];

      router = await Diamond.deploy(diamondCuts, { owner: owner.address, init: ZeroAddress, initCalldata: "0x" });
      const manager = await ethers.getContractAt("RouterManagementFacet", await router.getAddress(), deployer);
      await manager.connect(owner).approveTarget(converter.getAddress(), converter.getAddress());
    }
  });

  context("migrate", async () => {
    const migrateToFxBase = async (poolAddr: string, holderAddr: string, amount: bigint) => {
      await unlockAccounts([holderAddr]);
      const holder = await ethers.getSigner(holderAddr);
      await mockETHBalance(holderAddr, ethers.parseEther("100"));

      const facet = await ethers.getContractAt("FxUSDBasePoolFacet", await router.getAddress(), holder);
      const access = await ethers.getContractAt("AccessControl", poolAddr, deployer);
      await access
        .connect(owner)
        .grantRole("0x24ba51fc201891c1803eeafedeae076c0a88d453c20b1073528aa34d0cf55b79", router.getAddress());
      const pool = await ethers.getContractAt("IFxShareableRebalancePool", poolAddr, deployer);

      const holderBefore = await pool.balanceOf(holder.address);
      const deployerBefore = await fxBASE.balanceOf(deployer.address);
      await facet.migrateToFxBase(pool.getAddress(), amount, 0n, deployer.address);
      const holderAfter = await pool.balanceOf(holder.address);
      const deployerAfter = await fxBASE.balanceOf(deployer.address);
      expect(deployerAfter - deployerBefore).to.eq(amount);
      expect(holderBefore - holderAfter).to.eq(amount);
    };

    const migrateToFxBaseGauge = async (poolAddr: string, holderAddr: string, amount: bigint) => {
      await unlockAccounts([holderAddr]);
      const holder = await ethers.getSigner(holderAddr);
      await mockETHBalance(holderAddr, ethers.parseEther("100"));

      const facet = await ethers.getContractAt("FxUSDBasePoolFacet", await router.getAddress(), holder);
      const access = await ethers.getContractAt("AccessControl", poolAddr, deployer);
      await access
        .connect(owner)
        .grantRole("0x24ba51fc201891c1803eeafedeae076c0a88d453c20b1073528aa34d0cf55b79", router.getAddress());
      const pool = await ethers.getContractAt("IFxShareableRebalancePool", poolAddr, deployer);
      const w = await ethers.getContractAt("MockERC20", await gauge.getAddress(), deployer);

      const holderBefore = await pool.balanceOf(holder.address);
      const deployerBefore = await w.balanceOf(deployer.address);
      await facet.migrateToFxBaseGauge(pool.getAddress(), amount, 0n, deployer.address);
      const holderAfter = await pool.balanceOf(holder.address);
      const deployerAfter = await w.balanceOf(deployer.address);
      expect(deployerAfter - deployerBefore).to.eq(amount);
      expect(holderBefore - holderAfter).to.eq(amount);
    };

    it("should succeed, when migrateToFxBase from wstETH pool", async () => {
      await migrateToFxBase(
        "0x9aD382b028e03977D446635Ba6b8492040F829b7",
        "0xb8Aa5d63491c087D40Fee4311A89b1dCd74b0FDb",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when migrateToFxBase from xstETH pool", async () => {
      await migrateToFxBase(
        "0x0417CE2934899d7130229CDa39Db456Ff2332685",
        "0xF483De0f306952FA56ef56c1dbBDd2A70737bDd5",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when migrateToFxBase from sfrxETH pool", async () => {
      await migrateToFxBase(
        "0xb925F8CAA6BE0BFCd1A7383168D1c932D185A748",
        "0x6859F2e01A32bCC16C2e314A75945e3787D4CeDC",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when migrateToFxBase from xfrxETH pool", async () => {
      await migrateToFxBase(
        "0x4a2ab45D27428901E826db4a52Dae00594b68022",
        "0xa9d12e95b35e44A6fDE3A9879E99dd89E06dB5f0",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when migrateToFxBaseGauge from wstETH pool", async () => {
      await migrateToFxBaseGauge(
        "0x9aD382b028e03977D446635Ba6b8492040F829b7",
        "0xb8Aa5d63491c087D40Fee4311A89b1dCd74b0FDb",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when migrateToFxBaseGauge from xstETH pool", async () => {
      await migrateToFxBaseGauge(
        "0x0417CE2934899d7130229CDa39Db456Ff2332685",
        "0xF483De0f306952FA56ef56c1dbBDd2A70737bDd5",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when migrateToFxBaseGauge from sfrxETH pool", async () => {
      await migrateToFxBaseGauge(
        "0xb925F8CAA6BE0BFCd1A7383168D1c932D185A748",
        "0x6859F2e01A32bCC16C2e314A75945e3787D4CeDC",
        ethers.parseEther("100")
      );
    });

    it("should succeed, when migrateToFxBaseGauge from xfrxETH pool", async () => {
      await migrateToFxBaseGauge(
        "0x4a2ab45D27428901E826db4a52Dae00594b68022",
        "0xa9d12e95b35e44A6fDE3A9879E99dd89E06dB5f0",
        ethers.parseEther("100")
      );
    });
  });

  context("depositToFxBase", async () => {
    const depositToFxBase = async (
      holderAddr: string,
      convertInParams: { encoding: bigint; routes: Array<bigint> },
      tokenInAddr: string,
      amountIn: bigint,
      tokenOut: string
    ) => {
      await unlockAccounts([holderAddr]);
      const holder = await ethers.getSigner(holderAddr);
      await mockETHBalance(holderAddr, ethers.parseEther("100"));
      const tokenIn = await ethers.getContractAt("MockERC20", tokenInAddr, holder);
      const isETH = same(tokenInAddr, ZeroAddress);
      const facet = await ethers.getContractAt("FxUSDBasePoolFacet", await router.getAddress(), holder);
      await tokenIn.approve(facet.getAddress(), amountIn);
      const amountOut = await converter.queryConvert.staticCall(
        amountIn,
        convertInParams.encoding,
        convertInParams.routes
      );
      const slippage = 30n;
      const sharesOut = await fxBASE.previewDeposit(tokenOut, amountOut);
      const tokenBefore = isETH
        ? await ethers.provider.getBalance(holder.address)
        : await tokenIn.balanceOf(holder.address);
      const baseBefore = await fxBASE.balanceOf(deployer.address);
      const tx = await facet.depositToFxBase(
        {
          tokenIn: tokenInAddr,
          amount: amountIn,
          target: await converter.getAddress(),
          data: converter.interface.encodeFunctionData("convert", [
            tokenInAddr,
            amountIn,
            convertInParams.encoding,
            convertInParams.routes,
          ]),
          minOut: (amountOut * (10000n - slippage)) / 10000n,
          signature: "0x",
        },
        tokenOut,
        (sharesOut * (10000n - slippage)) / 10000n,
        deployer.address,
        { value: isETH ? amountIn : 0n }
      );
      const r = await tx.wait();
      const tokenAfter = isETH
        ? await ethers.provider.getBalance(holder.address)
        : await tokenIn.balanceOf(holder.address);
      const baseAfter = await fxBASE.balanceOf(deployer.address);
      expect(tokenBefore - tokenAfter).to.gt(amountOut + (isETH ? r!.gasPrice * r!.gasUsed : 0n));
      expect(baseAfter - baseBefore).to.gt(0n);
      console.log(
        `${isETH ? "ETH" : await tokenIn.symbol()}Deposited[${ethers.formatUnits(
          amountIn,
          isETH ? 18 : await tokenIn.decimals()
        )}] get fxBASE[${ethers.formatEther(baseAfter - baseBefore)}]`
      );
    };

    it("should succeed, when deposit with fxUSD by fxUSD", async () => {
      await depositToFxBase(
        "0xB1Fb33bF3A036742FFFAa9F96C548AcB0aE6a4bB",
        { encoding: 0n, routes: [] },
        EthereumTokens.fxUSD.address,
        ethers.parseEther("100"),
        EthereumTokens.fxUSD.address
      );
    });

    it("should succeed, when deposit with USDC by USDC", async () => {
      await depositToFxBase(
        "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
        { encoding: 0n, routes: [] },
        EthereumTokens.USDC.address,
        ethers.parseUnits("100", 6),
        EthereumTokens.USDC.address
      );
    });

    it("should succeed, when deposit with ETH by USDC", async () => {
      await depositToFxBase(
        "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
        MULTI_PATH_CONVERTER_ROUTES.WETH.USDC,
        ZeroAddress,
        ethers.parseUnits("1", 18),
        EthereumTokens.USDC.address
      );
    });

    it("should succeed, when deposit with WETH by USDC", async () => {
      await depositToFxBase(
        "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
        MULTI_PATH_CONVERTER_ROUTES.WETH.USDC,
        EthereumTokens.WETH.address,
        ethers.parseUnits("1", 18),
        EthereumTokens.USDC.address
      );
    });
  });

  context("depositToFxBaseGauge", async () => {
    const depositToFxBaseGauge = async (
      holderAddr: string,
      convertInParams: { encoding: bigint; routes: Array<bigint> },
      tokenInAddr: string,
      amountIn: bigint,
      tokenOut: string
    ) => {
      await unlockAccounts([holderAddr]);
      const holder = await ethers.getSigner(holderAddr);
      await mockETHBalance(holderAddr, ethers.parseEther("100"));
      const tokenIn = await ethers.getContractAt("MockERC20", tokenInAddr, holder);
      const isETH = same(tokenInAddr, ZeroAddress);
      const facet = await ethers.getContractAt("FxUSDBasePoolFacet", await router.getAddress(), holder);
      const w = await ethers.getContractAt("MockERC20", await gauge.getAddress(), deployer);
      await tokenIn.approve(facet.getAddress(), amountIn);
      const amountOut = await converter.queryConvert.staticCall(
        amountIn,
        convertInParams.encoding,
        convertInParams.routes
      );
      const slippage = 30n;
      const sharesOut = await fxBASE.previewDeposit(tokenOut, amountOut);
      const tokenBefore = isETH
        ? await ethers.provider.getBalance(holder.address)
        : await tokenIn.balanceOf(holder.address);
      const gaugeBefore = await w.balanceOf(deployer.address);
      const tx = await facet.depositToFxBaseGauge(
        {
          tokenIn: tokenInAddr,
          amount: amountIn,
          target: await converter.getAddress(),
          data: converter.interface.encodeFunctionData("convert", [
            tokenInAddr,
            amountIn,
            convertInParams.encoding,
            convertInParams.routes,
          ]),
          minOut: (amountOut * (10000n - slippage)) / 10000n,
          signature: "0x",
        },
        tokenOut,
        (sharesOut * (10000n - slippage)) / 10000n,
        deployer.address,
        { value: isETH ? amountIn : 0n }
      );
      const r = await tx.wait();
      const tokenAfter = isETH
        ? await ethers.provider.getBalance(holder.address)
        : await tokenIn.balanceOf(holder.address);
      const gaugeAfter = await w.balanceOf(deployer.address);
      expect(tokenBefore - tokenAfter).to.gt(amountOut + (isETH ? r!.gasPrice * r!.gasUsed : 0n));
      expect(gaugeAfter - gaugeBefore).to.gt(0n);
      console.log(
        `${isETH ? "ETH" : await tokenIn.symbol()}Deposited[${ethers.formatUnits(
          amountIn,
          isETH ? 18 : await tokenIn.decimals()
        )}] get fxBASEGauge[${ethers.formatEther(gaugeAfter - gaugeBefore)}]`
      );
    };

    it("should succeed, when deposit with fxUSD by fxUSD", async () => {
      await depositToFxBaseGauge(
        "0xB1Fb33bF3A036742FFFAa9F96C548AcB0aE6a4bB",
        { encoding: 0n, routes: [] },
        EthereumTokens.fxUSD.address,
        ethers.parseEther("100"),
        EthereumTokens.fxUSD.address
      );
    });

    it("should succeed, when deposit with USDC by USDC", async () => {
      await depositToFxBaseGauge(
        "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
        { encoding: 0n, routes: [] },
        EthereumTokens.USDC.address,
        ethers.parseUnits("100", 6),
        EthereumTokens.USDC.address
      );
    });

    it("should succeed, when deposit with ETH by USDC", async () => {
      await depositToFxBaseGauge(
        "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
        MULTI_PATH_CONVERTER_ROUTES.WETH.USDC,
        ZeroAddress,
        ethers.parseUnits("1", 18),
        EthereumTokens.USDC.address
      );
    });

    it("should succeed, when deposit with WETH by USDC", async () => {
      await depositToFxBaseGauge(
        "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
        MULTI_PATH_CONVERTER_ROUTES.WETH.USDC,
        EthereumTokens.WETH.address,
        ethers.parseUnits("1", 18),
        EthereumTokens.USDC.address
      );
    });
  });

  context("redeem", async () => {
    const USDC_HOLDER = "0x8EB8a3b98659Cce290402893d0123abb75E3ab28";
    const fxUSD_HOLDER = "0xB1Fb33bF3A036742FFFAa9F96C548AcB0aE6a4bB";

    let usdcHolder: HardhatEthersSigner;
    let fxUSDHolder: HardhatEthersSigner;
    let usdc: MockERC20;

    beforeEach(async () => {
      await unlockAccounts([USDC_HOLDER, fxUSD_HOLDER]);
      await mockETHBalance(USDC_HOLDER, ethers.parseEther("100"));
      await mockETHBalance(fxUSD_HOLDER, ethers.parseEther("100"));
      usdcHolder = await ethers.getSigner(USDC_HOLDER);
      fxUSDHolder = await ethers.getSigner(fxUSD_HOLDER);

      usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, usdcHolder);

      await usdc.connect(usdcHolder).approve(fxBASE.getAddress(), ethers.parseUnits("200", 6));
      await fxBASE.connect(usdcHolder).deposit(deployer.address, usdc.getAddress(), ethers.parseUnits("200", 6), 0n);
      await fxUSD.connect(fxUSDHolder).approve(fxBASE.getAddress(), ethers.parseUnits("300", 18));
      await fxBASE.connect(fxUSDHolder).deposit(deployer.address, fxUSD.getAddress(), ethers.parseUnits("300", 18), 0n);

      await fxBASE.connect(deployer).approve(gauge.getAddress(), ethers.parseEther("100"));
      await gauge.connect(deployer)["deposit(uint256)"](ethers.parseEther("100"));
    });

    /*
    context("redeemFromFxBase", async () => {
      const redeemFromFxBase = async (
        fxUSDConvertOut: { encoding: bigint; routes: Array<bigint> },
        USDCConvertOut: { encoding: bigint; routes: Array<bigint> },
        amountOut: bigint,
        tokenXAddr: string,
        tokenYAddr: string
      ) => {
        const slippage = 30n;
        const isXETH = same(tokenXAddr, ZeroAddress);
        const isYETH = same(tokenYAddr, ZeroAddress);
        const facet = await ethers.getContractAt("FxUSDBasePoolFacet", await router.getAddress(), deployer);
        const tokenX = await ethers.getContractAt("MockERC20", tokenXAddr, deployer);
        const tokenY = await ethers.getContractAt("MockERC20", tokenYAddr, deployer);

        const [fxUSDOut, USDCOut] = await fxBASE.previewRedeem(amountOut);
        const tokenXOut = same(tokenXAddr, await fxUSD.getAddress())
          ? fxUSDOut
          : await converter.queryConvert.staticCall(fxUSDOut, fxUSDConvertOut.encoding, fxUSDConvertOut.routes);
        const tokenYOut = same(tokenYAddr, await usdc.getAddress())
          ? USDCOut
          : await converter.queryConvert.staticCall(USDCOut, USDCConvertOut.encoding, USDCConvertOut.routes);

        await fxBASE.connect(deployer).approve(facet.getAddress(), amountOut);
        const xBalanceBefore = isXETH
          ? await ethers.provider.getBalance(USDC_HOLDER)
          : await tokenX.balanceOf(USDC_HOLDER);
        const yBalanceBefore = isYETH
          ? await ethers.provider.getBalance(USDC_HOLDER)
          : await tokenY.balanceOf(USDC_HOLDER);
        await facet.connect(deployer).redeemFromFxBase(
          {
            tokenOut: tokenXAddr,
            converter: await converter.getAddress(),
            encodings: fxUSDConvertOut.encoding,
            routes: fxUSDConvertOut.routes,
            minOut: (tokenXOut * (10000n - slippage)) / 10000n,
            signature: "0x",
          },
          {
            tokenOut: tokenYAddr,
            converter: await converter.getAddress(),
            encodings: USDCConvertOut.encoding,
            routes: USDCConvertOut.routes,
            minOut: (tokenYOut * (10000n - slippage)) / 10000n,
            signature: "0x",
          },
          amountOut,
          USDC_HOLDER
        );
        const xBalanceAfter = isXETH
          ? await ethers.provider.getBalance(USDC_HOLDER)
          : await tokenX.balanceOf(USDC_HOLDER);
        const yBalanceAfter = isYETH
          ? await ethers.provider.getBalance(USDC_HOLDER)
          : await tokenY.balanceOf(USDC_HOLDER);
        if (same(tokenXAddr, tokenYAddr)) {
          console.log(
            `Redeem${isXETH ? "ETH" : await tokenX.symbol()}[${ethers.formatUnits(
              xBalanceAfter - xBalanceBefore,
              isXETH ? 18 : await tokenX.decimals()
            )}]`
          );
        } else {
          console.log(
            `Redeem${isXETH ? "ETH" : await tokenX.symbol()}[${ethers.formatUnits(
              xBalanceAfter - xBalanceBefore,
              isXETH ? 18 : await tokenX.decimals()
            )}]`,
            `Redeem${isYETH ? "ETH" : await tokenY.symbol()}[${ethers.formatUnits(
              yBalanceAfter - yBalanceBefore,
              isYETH ? 18 : await tokenY.decimals()
            )}]`
          );
        }
      };

      it("should succeed when redeem both to fxUSD", async () => {
        await redeemFromFxBase(
          { encoding: 0n, routes: [] },
          MULTI_PATH_CONVERTER_ROUTES.USDC.fxUSD,
          ethers.parseEther("100"),
          EthereumTokens.fxUSD.address,
          EthereumTokens.fxUSD.address
        );
      });

      it("should succeed when redeem both to USDC", async () => {
        await redeemFromFxBase(
          MULTI_PATH_CONVERTER_ROUTES.fxUSD.USDC,
          { encoding: 0n, routes: [] },
          ethers.parseEther("100"),
          EthereumTokens.USDC.address,
          EthereumTokens.USDC.address
        );
      });

      it("should succeed when redeem both to ETH", async () => {
        await redeemFromFxBase(
          MULTI_PATH_CONVERTER_ROUTES.fxUSD.WETH,
          MULTI_PATH_CONVERTER_ROUTES.USDC.WETH,
          ethers.parseEther("100"),
          ZeroAddress,
          ZeroAddress
        );
      });

      it("should succeed when redeem both to WETH", async () => {
        await redeemFromFxBase(
          MULTI_PATH_CONVERTER_ROUTES.fxUSD.WETH,
          MULTI_PATH_CONVERTER_ROUTES.USDC.WETH,
          ethers.parseEther("100"),
          EthereumTokens.WETH.address,
          EthereumTokens.WETH.address
        );
      });

      it("should succeed when redeem fxUSD to ETH, redeem USDC to WETH", async () => {
        await redeemFromFxBase(
          MULTI_PATH_CONVERTER_ROUTES.fxUSD.WETH,
          MULTI_PATH_CONVERTER_ROUTES.USDC.WETH,
          ethers.parseEther("100"),
          ZeroAddress,
          EthereumTokens.WETH.address
        );
      });
    });

    context("redeemFromFxBaseGauge", async () => {
      const redeemFromFxBaseGauge = async (
        fxUSDConvertOut: { encoding: bigint; routes: Array<bigint> },
        USDCConvertOut: { encoding: bigint; routes: Array<bigint> },
        amountOut: bigint,
        tokenXAddr: string,
        tokenYAddr: string
      ) => {
        const slippage = 30n;
        const isXETH = same(tokenXAddr, ZeroAddress);
        const isYETH = same(tokenYAddr, ZeroAddress);
        const facet = await ethers.getContractAt("FxUSDBasePoolFacet", await router.getAddress(), deployer);
        const tokenX = await ethers.getContractAt("MockERC20", tokenXAddr, deployer);
        const tokenY = await ethers.getContractAt("MockERC20", tokenYAddr, deployer);

        const [fxUSDOut, USDCOut] = await fxBASE.previewRedeem(amountOut);
        const tokenXOut = same(tokenXAddr, await fxUSD.getAddress())
          ? fxUSDOut
          : await converter.queryConvert.staticCall(fxUSDOut, fxUSDConvertOut.encoding, fxUSDConvertOut.routes);
        const tokenYOut = same(tokenYAddr, await usdc.getAddress())
          ? USDCOut
          : await converter.queryConvert.staticCall(USDCOut, USDCConvertOut.encoding, USDCConvertOut.routes);

        const w = await ethers.getContractAt("MockERC20", await gauge.getAddress(), deployer);
        await w.connect(deployer).approve(facet.getAddress(), amountOut);
        const xBalanceBefore = isXETH
          ? await ethers.provider.getBalance(USDC_HOLDER)
          : await tokenX.balanceOf(USDC_HOLDER);
        const yBalanceBefore = isYETH
          ? await ethers.provider.getBalance(USDC_HOLDER)
          : await tokenY.balanceOf(USDC_HOLDER);
        await facet.connect(deployer).redeemFromFxBaseGauge(
          {
            tokenOut: tokenXAddr,
            converter: await converter.getAddress(),
            encodings: fxUSDConvertOut.encoding,
            routes: fxUSDConvertOut.routes,
            minOut: (tokenXOut * (10000n - slippage)) / 10000n,
            signature: "0x",
          },
          {
            tokenOut: tokenYAddr,
            converter: await converter.getAddress(),
            encodings: USDCConvertOut.encoding,
            routes: USDCConvertOut.routes,
            minOut: (tokenYOut * (10000n - slippage)) / 10000n,
            signature: "0x",
          },
          amountOut,
          USDC_HOLDER
        );
        const xBalanceAfter = isXETH
          ? await ethers.provider.getBalance(USDC_HOLDER)
          : await tokenX.balanceOf(USDC_HOLDER);
        const yBalanceAfter = isYETH
          ? await ethers.provider.getBalance(USDC_HOLDER)
          : await tokenY.balanceOf(USDC_HOLDER);
        if (same(tokenXAddr, tokenYAddr)) {
          console.log(
            `Redeem${isXETH ? "ETH" : await tokenX.symbol()}[${ethers.formatUnits(
              xBalanceAfter - xBalanceBefore,
              isXETH ? 18 : await tokenX.decimals()
            )}]`
          );
        } else {
          console.log(
            `Redeem${isXETH ? "ETH" : await tokenX.symbol()}[${ethers.formatUnits(
              xBalanceAfter - xBalanceBefore,
              isXETH ? 18 : await tokenX.decimals()
            )}]`,
            `Redeem${isYETH ? "ETH" : await tokenY.symbol()}[${ethers.formatUnits(
              yBalanceAfter - yBalanceBefore,
              isYETH ? 18 : await tokenY.decimals()
            )}]`
          );
        }
      };

      it("should succeed when redeem both to fxUSD", async () => {
        await redeemFromFxBaseGauge(
          { encoding: 0n, routes: [] },
          MULTI_PATH_CONVERTER_ROUTES.USDC.fxUSD,
          ethers.parseEther("100"),
          EthereumTokens.fxUSD.address,
          EthereumTokens.fxUSD.address
        );
      });

      it("should succeed when redeem both to USDC", async () => {
        await redeemFromFxBaseGauge(
          MULTI_PATH_CONVERTER_ROUTES.fxUSD.USDC,
          { encoding: 0n, routes: [] },
          ethers.parseEther("100"),
          EthereumTokens.USDC.address,
          EthereumTokens.USDC.address
        );
      });

      it("should succeed when redeem both to ETH", async () => {
        await redeemFromFxBaseGauge(
          MULTI_PATH_CONVERTER_ROUTES.fxUSD.WETH,
          MULTI_PATH_CONVERTER_ROUTES.USDC.WETH,
          ethers.parseEther("100"),
          ZeroAddress,
          ZeroAddress
        );
      });

      it("should succeed when redeem both to WETH", async () => {
        await redeemFromFxBaseGauge(
          MULTI_PATH_CONVERTER_ROUTES.fxUSD.WETH,
          MULTI_PATH_CONVERTER_ROUTES.USDC.WETH,
          ethers.parseEther("100"),
          EthereumTokens.WETH.address,
          EthereumTokens.WETH.address
        );
      });

      it("should succeed when redeem fxUSD to ETH, redeem USDC to WETH", async () => {
        await redeemFromFxBaseGauge(
          MULTI_PATH_CONVERTER_ROUTES.fxUSD.WETH,
          MULTI_PATH_CONVERTER_ROUTES.USDC.WETH,
          ethers.parseEther("100"),
          ZeroAddress,
          EthereumTokens.WETH.address
        );
      });
    });
    */
  });
});
