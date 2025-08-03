// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

import { ProxyAdmin } from "@openzeppelin/contracts-v4/proxy/transparent/ProxyAdmin.sol";
import { TransparentUpgradeableProxy, ITransparentUpgradeableProxy } from "@openzeppelin/contracts-v4/proxy/transparent/TransparentUpgradeableProxy.sol";

import { MockAggregatorV3Interface } from "../../contracts/mocks/MockAggregatorV3Interface.sol";
import { MockCurveStableSwapNG } from "../../contracts/mocks/MockCurveStableSwapNG.sol";
import { MockPriceOracle } from "../../contracts/mocks/MockPriceOracle.sol";
import { MockRateProvider } from "../../contracts/mocks/MockRateProvider.sol";
import { MockAaveV3Pool } from "../../contracts/mocks/MockAaveV3Pool.sol";
import { MockMultiPathConverter } from "../../contracts/mocks/MockMultiPathConverter.sol";
import { MockMultipleRewardDistributor } from "../../contracts/mocks/MockMultipleRewardDistributor.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";

import { AaveFundingPool } from "../../contracts/core/pool/AaveFundingPool.sol";
import { CreditNote } from "../../contracts/core/short/CreditNote.sol";
import { ShortPool } from "../../contracts/core/short/ShortPool.sol";
import { ShortPoolManager } from "../../contracts/core/short/ShortPoolManager.sol";
import { FxUSDBasePool } from "../../contracts/core/FxUSDBasePool.sol";
import { FxUSDPriceOracle } from "../../contracts/core/FxUSDPriceOracle.sol";
import { FxUSDRegeneracy } from "../../contracts/core/FxUSDRegeneracy.sol";
import { PegKeeper } from "../../contracts/core/PegKeeper.sol";
import { PoolConfiguration } from "../../contracts/core/PoolConfiguration.sol";
import { PoolManager } from "../../contracts/core/PoolManager.sol";
import { ReservePool } from "../../contracts/core/ReservePool.sol";
import { EmptyContract } from "../../contracts/helpers/EmptyContract.sol";
import { GaugeRewarder } from "../../contracts/helpers/GaugeRewarder.sol";
import { RevenuePool } from "../../contracts/helpers/RevenuePool.sol";
import { SmartWalletWhitelist } from "../../contracts/voting-escrow/SmartWalletWhitelist.sol";

abstract contract PoolTestBase is Test {
  MockAggregatorV3Interface internal mockAggregatorV3Interface;
  MockCurveStableSwapNG internal mockCurveStableSwapNG;
  MockPriceOracle internal mockLongPriceOracle;
  MockPriceOracle internal mockShortPriceOracle;
  MockRateProvider internal mockRateProvider;
  MockAaveV3Pool internal mockAaveV3Pool;
  MockMultiPathConverter private mockConverter;
  MockMultipleRewardDistributor private mockGauge;

  MockERC20 internal stableToken;
  MockERC20 internal collateralToken;

  address internal admin;
  address internal treasury;

  SmartWalletWhitelist internal whitelist;
  ProxyAdmin internal proxyAdmin;
  PoolConfiguration internal poolConfiguration;
  PegKeeper internal pegKeeper;
  FxUSDRegeneracy internal fxUSD;
  FxUSDPriceOracle internal fxUSDPriceOracle;
  FxUSDBasePool internal fxBASE;

  GaugeRewarder internal rewarder;
  ReservePool internal reservePool;

  RevenuePool internal openRevenuePool;
  RevenuePool internal closeRevenuePool;
  RevenuePool internal miscRevenuePool;

  PoolManager internal poolManager;
  AaveFundingPool internal longPool;

  ShortPoolManager internal shortPoolManager;
  CreditNote internal creditNote;
  ShortPool internal shortPool;

  function __PoolTestBase_setUp(uint256 TokenRate, uint8 tokenDecimals) internal {
    admin = address(this);
    treasury = makeAddr("treasury");
    openRevenuePool = new RevenuePool(treasury, treasury, admin);
    closeRevenuePool = new RevenuePool(treasury, treasury, admin);
    miscRevenuePool = new RevenuePool(treasury, treasury, admin);

    whitelist = new SmartWalletWhitelist(admin);
    whitelist.approveWallet(address(this));

    _deployMockContracts(TokenRate);
    _deployContracts(tokenDecimals);
    _setupParameters();
  }

  function _deployMockContracts(uint256 TokenRate) private {
    mockAggregatorV3Interface = new MockAggregatorV3Interface(8, 100000000);
    mockCurveStableSwapNG = new MockCurveStableSwapNG();
    mockLongPriceOracle = new MockPriceOracle(3000 ether, 2999 ether, 3001 ether);
    mockShortPriceOracle = new MockPriceOracle(3000 ether, 2999 ether, 3001 ether);
    mockRateProvider = new MockRateProvider(TokenRate);
    mockAaveV3Pool = new MockAaveV3Pool(0);
    mockConverter = new MockMultiPathConverter();
    mockGauge = new MockMultipleRewardDistributor();

    mockAaveV3Pool.setVariableBorrowRate(0.05 * 1e27); // 5%
    mockAaveV3Pool.setReserveNormalizedVariableDebt(1e27); // 1
  }

  function _deployContracts(uint8 tokenDecimals) private {
    EmptyContract empty = new EmptyContract();
    stableToken = new MockERC20("USDC", "USDC", 6);
    collateralToken = new MockERC20("X", "Y", tokenDecimals);
    proxyAdmin = new ProxyAdmin();
    rewarder = new GaugeRewarder(address(mockGauge));

    // deploy proxy contracts
    TransparentUpgradeableProxy FxUSDRegeneracyProxy = new TransparentUpgradeableProxy(
      address(empty),
      address(proxyAdmin),
      new bytes(0)
    );
    TransparentUpgradeableProxy FxUSDPriceOracleProxy = new TransparentUpgradeableProxy(
      address(empty),
      address(proxyAdmin),
      new bytes(0)
    );
    TransparentUpgradeableProxy PoolConfigurationProxy = new TransparentUpgradeableProxy(
      address(empty),
      address(proxyAdmin),
      new bytes(0)
    );
    TransparentUpgradeableProxy PegKeeperProxy = new TransparentUpgradeableProxy(
      address(empty),
      address(proxyAdmin),
      new bytes(0)
    );
    TransparentUpgradeableProxy FxUSDBasePoolProxy = new TransparentUpgradeableProxy(
      address(empty),
      address(proxyAdmin),
      new bytes(0)
    );
    TransparentUpgradeableProxy PoolManagerProxy = new TransparentUpgradeableProxy(
      address(empty),
      address(proxyAdmin),
      new bytes(0)
    );
    TransparentUpgradeableProxy LongPoolProxy = new TransparentUpgradeableProxy(
      address(empty),
      address(proxyAdmin),
      new bytes(0)
    );
    TransparentUpgradeableProxy ShortPoolManagerProxy = new TransparentUpgradeableProxy(
      address(empty),
      address(proxyAdmin),
      new bytes(0)
    );
    TransparentUpgradeableProxy CreditNoteProxy = new TransparentUpgradeableProxy(
      address(empty),
      address(proxyAdmin),
      new bytes(0)
    );
    TransparentUpgradeableProxy ShortPoolProxy = new TransparentUpgradeableProxy(
      address(empty),
      address(proxyAdmin),
      new bytes(0)
    );

    // deploy ReservePool
    reservePool = new ReservePool(admin, address(PoolManagerProxy));

    // deploy PoolManager
    {
      PoolManager PoolManagerImpl = new PoolManager(
        address(FxUSDRegeneracyProxy),
        address(FxUSDBasePoolProxy),
        address(ShortPoolManagerProxy),
        address(PoolConfigurationProxy),
        address(whitelist)
      );
      proxyAdmin.upgradeAndCall(
        ITransparentUpgradeableProxy(address(PoolManagerProxy)),
        address(PoolManagerImpl),
        abi.encodeCall(
          PoolManager.initialize,
          (admin, 0, 0, 0, treasury, address(openRevenuePool), address(reservePool))
        )
      );
      poolManager = PoolManager(address(PoolManagerProxy));
    }

    // deploy FxUSDRegeneracy
    {
      FxUSDRegeneracy FxUSDRegeneracyImpl = new FxUSDRegeneracy(
        address(PoolManagerProxy),
        address(stableToken),
        address(PegKeeperProxy)
      );
      proxyAdmin.upgrade(ITransparentUpgradeableProxy(address(FxUSDRegeneracyProxy)), address(FxUSDRegeneracyImpl));
      fxUSD = FxUSDRegeneracy(address(FxUSDRegeneracyProxy));
      fxUSD.initialize("f(x) USD", "fxUSD");
      fxUSD.initializeV2();
    }

    // deploy FxUSDBasePool
    {
      FxUSDBasePool FxUSDBasePoolImpl = new FxUSDBasePool(
        address(PoolManagerProxy),
        address(PegKeeperProxy),
        address(FxUSDRegeneracyProxy),
        address(stableToken),
        encodeChainlinkPriceFeed(address(mockAggregatorV3Interface), 10000000000, 1000000000)
      );
      proxyAdmin.upgrade(ITransparentUpgradeableProxy(address(FxUSDBasePoolProxy)), address(FxUSDBasePoolImpl));
      fxBASE = FxUSDBasePool(address(FxUSDBasePoolProxy));
      fxBASE.initialize(admin, "fxBASE", "fxBASE", 0, 1);
    }

    // deploy FxUSDPriceOracle
    {
      FxUSDPriceOracle FxUSDPriceOracleImpl = new FxUSDPriceOracle(address(FxUSDRegeneracyProxy));
      proxyAdmin.upgrade(ITransparentUpgradeableProxy(address(FxUSDPriceOracleProxy)), address(FxUSDPriceOracleImpl));
      fxUSDPriceOracle = FxUSDPriceOracle(address(FxUSDPriceOracleProxy));
      fxUSDPriceOracle.initialize(admin, address(mockCurveStableSwapNG));
    }

    // deploy PegKeeper
    {
      PegKeeper PegKeeperImpl = new PegKeeper(address(fxBASE));
      proxyAdmin.upgradeAndCall(
        ITransparentUpgradeableProxy(address(PegKeeperProxy)),
        address(PegKeeperImpl),
        abi.encodeCall(PegKeeper.initialize, (admin, address(mockConverter), address(mockCurveStableSwapNG)))
      );
      pegKeeper = PegKeeper(address(PegKeeperProxy));
    }

    // deploy PoolConfiguration
    {
      PoolConfiguration PoolConfigurationImpl = new PoolConfiguration(
        address(FxUSDBasePoolProxy),
        address(mockAaveV3Pool),
        address(stableToken)
      );
      proxyAdmin.upgrade(ITransparentUpgradeableProxy(address(PoolConfigurationProxy)), address(PoolConfigurationImpl));
      poolConfiguration = PoolConfiguration(address(PoolConfigurationProxy));
      poolConfiguration.initialize(admin, address(fxUSDPriceOracle));
    }

    // deploy AaveFundingPool
    {
      AaveFundingPool LongPoolImpl = new AaveFundingPool(address(poolManager), address(PoolConfigurationProxy));
      proxyAdmin.upgradeAndCall(
        ITransparentUpgradeableProxy(address(LongPoolProxy)),
        address(LongPoolImpl),
        abi.encodeCall(
          AaveFundingPool.initialize,
          (admin, "f(x) wstETH position", "xstETH", address(collateralToken), address(mockLongPriceOracle))
        )
      );
      longPool = AaveFundingPool(address(LongPoolProxy));
    }

    // deploy ShortPoolManager
    {
      ShortPoolManager ShortPoolManagerImpl = new ShortPoolManager(
        address(FxUSDRegeneracyProxy),
        address(poolManager),
        address(PoolConfigurationProxy),
        address(whitelist)
      );
      proxyAdmin.upgradeAndCall(
        ITransparentUpgradeableProxy(address(ShortPoolManagerProxy)),
        address(ShortPoolManagerImpl),
        abi.encodeCall(
          ShortPoolManager.initialize,
          (admin, 0, 0, 0, treasury, address(openRevenuePool), address(reservePool))
        )
      );
      shortPoolManager = ShortPoolManager(address(ShortPoolManagerProxy));
    }

    // deploy CreditNote
    {
      CreditNote CreditNoteImpl = new CreditNote(address(PoolManagerProxy));
      proxyAdmin.upgrade(ITransparentUpgradeableProxy(address(CreditNoteProxy)), address(CreditNoteImpl));
      creditNote = CreditNote(address(CreditNoteProxy));
      creditNote.initialize("f(x) Credit Note", "fxCN", tokenDecimals);
    }

    // deploy ShortPool
    {
      ShortPool ShortPoolImpl = new ShortPool(address(ShortPoolManagerProxy), address(PoolConfigurationProxy));
      proxyAdmin.upgradeAndCall(
        ITransparentUpgradeableProxy(address(ShortPoolProxy)),
        address(ShortPoolImpl),
        abi.encodeCall(
          ShortPool.initialize,
          (
            admin,
            "f(x) Short Position",
            "xShort",
            address(mockShortPriceOracle),
            address(collateralToken),
            address(creditNote)
          )
        )
      );
      shortPool = ShortPool(address(ShortPoolProxy));
    }
  }

  function _setupParameters() private {
    // setup parameters for mock contracts
    mockCurveStableSwapNG.setCoin(0, address(stableToken));
    mockCurveStableSwapNG.setCoin(1, address(fxUSD));
    mockCurveStableSwapNG.setPriceOracle(0, 1 ether);

    // setup parameters for long side
    poolManager.registerPool(address(longPool), uint96(1000000000 ether), uint96(1000000000 ether));
    poolManager.updateRateProvider(address(collateralToken), address(mockRateProvider));
    poolManager.updateCloseRevenuePool(address(closeRevenuePool));
    poolManager.updateMiscRevenuePool(address(miscRevenuePool));
    poolConfiguration.updatePoolFeeRatio(address(longPool), address(0), 0, 1, 0, 0, 0);
    longPool.updateCounterparty(address(shortPool));

    // setup parameters for short side
    shortPoolManager.registerPool(
      address(shortPool),
      address(rewarder),
      uint96(1000000000 ether),
      uint96(1000000000 ether),
      0
    );
    shortPoolManager.updateRateProvider(address(collateralToken), address(0));
    shortPoolManager.updateCloseRevenuePool(address(closeRevenuePool));
    shortPoolManager.updateMiscRevenuePool(address(miscRevenuePool));
    poolConfiguration.updatePoolFeeRatio(address(shortPool), address(0), 0, 1, 0, 0, 0);
    shortPool.updateCounterparty(address(longPool));
  }

  function encodeChainlinkPriceFeed(address feed, uint256 scale, uint256 heartbeat) internal pure returns (bytes32 r) {
    assembly {
      r := shl(96, feed)
      r := or(r, shl(32, scale))
      r := or(r, heartbeat)
    }
  }
}
