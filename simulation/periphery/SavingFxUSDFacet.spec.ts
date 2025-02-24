import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";

import {
  Diamond,
  FxUSDBasePool,
  MockERC20,
  MultiPathConverter,
  ProxyAdmin,
  DiamondCutFacet__factory,
  DiamondLoupeFacet__factory,
  OwnershipFacet__factory,
  RouterManagementFacet__factory,
  SavingFxUSD,
  RewardHarvester,
  SavingFxUSD__factory,
  SavingFxUSDFacet__factory,
} from "@/types/index";

import { forkNetworkAndUnlockAccounts, mockETHBalance, unlockAccounts } from "@/test/utils";
import { EthereumTokens, MULTI_PATH_CONVERTER_ROUTES, same } from "@/utils/index";
import { id, Interface, ZeroAddress } from "ethers";

const FORK_HEIGHT = 21802842;
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

  let gauge: MockERC20;
  let fxBASE: FxUSDBasePool;
  let fxSAVE: SavingFxUSD;
  let harvester: RewardHarvester;

  let converter: MultiPathConverter;
  let router: Diamond;

  beforeEach(async () => {
    await forkNetworkAndUnlockAccounts(FORK_URL, FORK_HEIGHT, [DEPLOYER, OWNER]);
    await mockETHBalance(DEPLOYER, ethers.parseEther("100"));
    await mockETHBalance(OWNER, ethers.parseEther("100"));
    deployer = await ethers.getSigner(DEPLOYER);
    owner = await ethers.getSigner(OWNER);

    proxyAdmin = await ethers.getContractAt("ProxyAdmin", "0x9B54B7703551D9d0ced177A78367560a8B2eDDA4", owner);
    fxBASE = await ethers.getContractAt("FxUSDBasePool", "0x65C9A641afCEB9C0E6034e558A319488FA0FA3be", owner);
    gauge = await ethers.getContractAt("MockERC20", "0xEd92dDe3214c24Ae04F5f96927E3bE8f8DbC3289", owner);

    const EmptyContract = await ethers.getContractFactory("EmptyContract", deployer);
    const TransparentUpgradeableProxy = await ethers.getContractFactory("TransparentUpgradeableProxy", deployer);
    const SavingFxUSD = await ethers.getContractFactory("SavingFxUSD", deployer);
    const RewardHarvester = await ethers.getContractFactory("RewardHarvester", deployer);
    const MultiPathConverter = await ethers.getContractFactory("MultiPathConverter", deployer);

    const empty = await EmptyContract.deploy();
    converter = await MultiPathConverter.deploy("0x11C907b3aeDbD863e551c37f21DD3F36b28A6784");
    const SavingFxUSDProxy = await TransparentUpgradeableProxy.deploy(
      empty.getAddress(),
      proxyAdmin.getAddress(),
      "0x"
    );
    const SavingFxUSDImpl = await SavingFxUSD.deploy(fxBASE.getAddress(), gauge.getAddress());

    harvester = await RewardHarvester.deploy(SavingFxUSDProxy.getAddress());
    await proxyAdmin.upgradeAndCall(
      SavingFxUSDProxy.getAddress(),
      SavingFxUSDImpl.getAddress(),
      SavingFxUSD__factory.createInterface().encodeFunctionData("initialize", [
        owner.address,
        {
          name: "Saving f(x) USD",
          symbol: "fxSAVE",
          pid: 36,
          threshold: ethers.parseEther("100"),
          treasury: PLATFORM,
          harvester: await harvester.getAddress(),
        },
      ])
    );
    fxSAVE = await ethers.getContractAt("SavingFxUSD", await SavingFxUSDProxy.getAddress());

    // deploy Facets and Diamond
    {
      const Diamond = await ethers.getContractFactory("Diamond", deployer);
      const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet", deployer);
      const DiamondLoupeFacet = await ethers.getContractFactory("DiamondLoupeFacet", deployer);
      const OwnershipFacet = await ethers.getContractFactory("OwnershipFacet", deployer);
      const RouterManagementFacet = await ethers.getContractFactory("RouterManagementFacet", deployer);
      const SavingFxUSDFacet = await ethers.getContractFactory("SavingFxUSDFacet", deployer);
      const cut = await DiamondCutFacet.deploy();
      const loupe = await DiamondLoupeFacet.deploy();
      const ownership = await OwnershipFacet.deploy();
      const routerManagement = await RouterManagementFacet.deploy();
      const savingFxUSD = await SavingFxUSDFacet.deploy(fxBASE.getAddress(), fxSAVE.getAddress());

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
          facetAddress: await savingFxUSD.getAddress(),
          action: 0,
          functionSelectors: getAllSignatures(SavingFxUSDFacet__factory.createInterface()),
        },
      ];

      router = await Diamond.deploy(diamondCuts, { owner: owner.address, init: ZeroAddress, initCalldata: "0x" });
      const manager = await ethers.getContractAt("RouterManagementFacet", await router.getAddress(), deployer);
      await manager.connect(owner).approveTarget(converter.getAddress(), converter.getAddress());
    }
  });

  context("depositToFxSave", async () => {
    const depositToFxSave = async (
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
      const facet = await ethers.getContractAt("SavingFxUSDFacet", await router.getAddress(), holder);
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
      const baseBefore = await fxSAVE.balanceOf(deployer.address);
      const tx = await facet.depositToFxSave(
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
      const baseAfter = await fxSAVE.balanceOf(deployer.address);
      expect(tokenBefore - tokenAfter).to.gt(amountOut + (isETH ? r!.gasPrice * r!.gasUsed : 0n));
      expect(baseAfter - baseBefore).to.gt(0n);
      console.log(
        `${isETH ? "ETH" : await tokenIn.symbol()} Deposited[${ethers.formatUnits(
          amountIn,
          isETH ? 18 : await tokenIn.decimals()
        )}] get fxSAVE[${ethers.formatEther(baseAfter - baseBefore)}]`
      );
    };

    it("should succeed, when deposit with fxUSD by fxUSD", async () => {
      await depositToFxSave(
        "0xB1Fb33bF3A036742FFFAa9F96C548AcB0aE6a4bB",
        { encoding: 0n, routes: [] },
        EthereumTokens.fxUSD.address,
        ethers.parseEther("100"),
        EthereumTokens.fxUSD.address
      );
    });

    it("should succeed, when deposit with USDC by USDC", async () => {
      await depositToFxSave(
        "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
        { encoding: 0n, routes: [] },
        EthereumTokens.USDC.address,
        ethers.parseUnits("100", 6),
        EthereumTokens.USDC.address
      );
    });

    it("should succeed, when deposit with ETH by USDC", async () => {
      await depositToFxSave(
        "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
        MULTI_PATH_CONVERTER_ROUTES.WETH.USDC,
        ZeroAddress,
        ethers.parseUnits("1", 18),
        EthereumTokens.USDC.address
      );
    });

    it("should succeed, when deposit with WETH by USDC", async () => {
      await depositToFxSave(
        "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
        MULTI_PATH_CONVERTER_ROUTES.WETH.USDC,
        EthereumTokens.WETH.address,
        ethers.parseUnits("1", 18),
        EthereumTokens.USDC.address
      );
    });
  });

  context("redeemFromFxSave", async () => {
    const USDC_HOLDER = "0x8EB8a3b98659Cce290402893d0123abb75E3ab28";
    const fxUSD_HOLDER = "0xB1Fb33bF3A036742FFFAa9F96C548AcB0aE6a4bB";

    let usdcHolder: HardhatEthersSigner;
    let fxUSDHolder: HardhatEthersSigner;
    let usdc: MockERC20;
    let fxUSD: MockERC20;

    beforeEach(async () => {
      await unlockAccounts([USDC_HOLDER, fxUSD_HOLDER]);
      await mockETHBalance(USDC_HOLDER, ethers.parseEther("100"));
      await mockETHBalance(fxUSD_HOLDER, ethers.parseEther("100"));
      usdcHolder = await ethers.getSigner(USDC_HOLDER);
      fxUSDHolder = await ethers.getSigner(fxUSD_HOLDER);

      usdc = await ethers.getContractAt("MockERC20", EthereumTokens.USDC.address, usdcHolder);
      fxUSD = await ethers.getContractAt("MockERC20", EthereumTokens.fxUSD.address, usdcHolder);

      await usdc.connect(usdcHolder).approve(fxBASE.getAddress(), ethers.parseUnits("200", 6));
      await fxBASE.connect(usdcHolder).deposit(deployer.address, usdc.getAddress(), ethers.parseUnits("200", 6), 0n);
      await fxUSD.connect(fxUSDHolder).approve(fxBASE.getAddress(), ethers.parseUnits("300", 18));
      await fxBASE.connect(fxUSDHolder).deposit(deployer.address, fxUSD.getAddress(), ethers.parseUnits("300", 18), 0n);

      await fxBASE.connect(deployer).approve(fxSAVE.getAddress(), ethers.parseEther("100"));
      await fxSAVE.connect(deployer).deposit(ethers.parseEther("100"), deployer.address);
      await fxSAVE.connect(deployer).requestRedeem(ethers.parseEther("100"));
      const lastTimestamp = Number((await ethers.provider.getBlock("latest"))!.timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [lastTimestamp + 86400]);
      await fxSAVE.connect(owner).grantRole(id("CLAIM_FOR_ROLE"), router.getAddress());
    });

    const redeemFromFxSave = async (
      fxUSDConvertOut: { encoding: bigint; routes: Array<bigint> },
      USDCConvertOut: { encoding: bigint; routes: Array<bigint> },
      amountOut: bigint,
      tokenXAddr: string,
      tokenYAddr: string
    ) => {
      const slippage = 30n;
      const isXETH = same(tokenXAddr, ZeroAddress);
      const isYETH = same(tokenYAddr, ZeroAddress);
      const facet = await ethers.getContractAt("SavingFxUSDFacet", await router.getAddress(), deployer);
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
      await facet.connect(deployer).redeemFromFxSave(
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
      await redeemFromFxSave(
        { encoding: 0n, routes: [] },
        MULTI_PATH_CONVERTER_ROUTES.USDC.fxUSD,
        ethers.parseEther("100"),
        EthereumTokens.fxUSD.address,
        EthereumTokens.fxUSD.address
      );
    });

    it("should succeed when redeem both to USDC", async () => {
      await redeemFromFxSave(
        MULTI_PATH_CONVERTER_ROUTES.fxUSD.USDC,
        { encoding: 0n, routes: [] },
        ethers.parseEther("100"),
        EthereumTokens.USDC.address,
        EthereumTokens.USDC.address
      );
    });

    it("should succeed when redeem both to ETH", async () => {
      await redeemFromFxSave(
        MULTI_PATH_CONVERTER_ROUTES.fxUSD.WETH,
        MULTI_PATH_CONVERTER_ROUTES.USDC.WETH,
        ethers.parseEther("100"),
        ZeroAddress,
        ZeroAddress
      );
    });

    it("should succeed when redeem both to WETH", async () => {
      await redeemFromFxSave(
        MULTI_PATH_CONVERTER_ROUTES.fxUSD.WETH,
        MULTI_PATH_CONVERTER_ROUTES.USDC.WETH,
        ethers.parseEther("100"),
        EthereumTokens.WETH.address,
        EthereumTokens.WETH.address
      );
    });

    it("should succeed when redeem fxUSD to ETH, redeem USDC to WETH", async () => {
      await redeemFromFxSave(
        MULTI_PATH_CONVERTER_ROUTES.fxUSD.WETH,
        MULTI_PATH_CONVERTER_ROUTES.USDC.WETH,
        ethers.parseEther("100"),
        ZeroAddress,
        EthereumTokens.WETH.address
      );
    });
  });
});
