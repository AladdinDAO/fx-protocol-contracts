import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { Interface, ZeroAddress } from "ethers";

import { ChainlinkPriceFeed } from "@/utils/index.ts";
import { encodeChainlinkPriceFeed, EthereumTokens } from "@/utils/index.ts";
import {
  DiamondCutFacet__factory,
  DiamondLoupeFacet__factory,
  OwnershipFacet__factory,
  PositionOperateFacet__factory,
  RouterManagementFacet__factory,
  SavingFxUSDFacet__factory,
} from "@/types/index.ts";
import { MultiPathConverter } from "@/types/contracts/helpers/converter/index.ts";

const getAllSignatures = (e: Interface): string[] => {
  const sigs: string[] = [];
  e.forEachFunction((func, _) => {
    sigs.push(func.selector);
  });
  return sigs;
};

export default buildModule("Upgrade202510xx", (m) => {
  const owner = m.getAccount(0);

  // deploy FxUSDBasePool implementation
  const FxUSDBasePoolImplementation = m.contract(
    "FxUSDBasePool",
    [
      m.getParameter("PoolManagerProxy"),
      m.getParameter("PegKeeperProxy"),
      m.getParameter("FxUSDProxy"),
      EthereumTokens.USDC.address,
      m.getParameter("FxUSDPriceOracleProxy"),
    ],
    { id: "FxUSDBasePoolImplementation" }
  );

  // deploy FxUSDPriceOracle implementation
  const FxUSDPriceOracleImplementation = m.contract(
    "FxUSDPriceOracle",
    [
      m.getParameter("FxUSDProxy"),
      encodeChainlinkPriceFeed(
        ChainlinkPriceFeed.ethereum["USDC-USD"].feed,
        ChainlinkPriceFeed.ethereum["USDC-USD"].scale,
        ChainlinkPriceFeed.ethereum["USDC-USD"].heartbeat
      ),
    ],
    {
      id: "FxUSDPriceOracleImplementation",
    }
  );

  // deploy PoolConfiguration implementation
  const PoolConfigurationImplementation = m.contract(
    "PoolConfiguration",
    [
      m.getParameter("FxUSDBasePoolProxy"),
      m.getParameter("AaveLendingPool"),
      m.getParameter("AaveBaseAsset"),
      m.getParameter("PoolManagerProxy"),
      m.getParameter("ShortPoolManagerProxy"),
    ],
    { id: "PoolConfigurationImplementation" }
  );

  // deploy AaveFundingPool implementation
  const AaveFundingPoolImplementation = m.contract(
    "AaveFundingPool",
    [m.getParameter("PoolManagerProxy"), m.getParameter("PoolConfigurationProxy")],
    { id: "AaveFundingPoolImplementation" }
  );

  // deploy PoolManager implementation
  const PoolManagerImplementation = m.contract(
    "PoolManager",
    [
      m.getParameter("FxUSDProxy"),
      m.getParameter("FxUSDBasePoolProxy"),
      m.getParameter("ShortPoolManagerProxy"),
      m.getParameter("PoolConfigurationProxy"),
      ZeroAddress,
    ],
    { id: "PoolManagerImplementation" }
  );

  // deploy ShortPoolManager implementation
  const ShortPoolManagerImplementation = m.contract(
    "ShortPoolManager",
    [
      m.getParameter("FxUSDProxy"),
      m.getParameter("PoolManagerProxy"),
      m.getParameter("PoolConfigurationProxy"),
      ZeroAddress,
    ],
    { id: "ShortPoolManagerImplementation" }
  );

  // deploy ShortPool implementation
  const ShortPoolImplementation = m.contract(
    "ShortPool",
    [m.getParameter("ShortPoolManagerProxy"), m.getParameter("PoolConfigurationProxy")],
    { id: "ShortPoolImplementation" }
  );

  // deploy SavingFxUSDFacet
  const SavingFxUSDFacet = m.contract("SavingFxUSDFacet", [
    m.getParameter("FxUSDBasePoolProxy"),
    m.getParameter("SavingFxUSDProxy"),
  ]);

  // deploy PositionOperateFacet
  const PositionOperateFacet = m.contract("PositionOperateFacet", []);

  // upgrades
  /*
  const ProxyAdmin = m.contractAt("ProxyAdmin", "0x9B54B7703551D9d0ced177A78367560a8B2eDDA4");
  m.call(ProxyAdmin, "upgrade", [m.getParameter("FxUSDBasePoolProxy"), FxUSDBasePoolImplementation], {
    id: "FxUSDBasePoolProxy_upgrade",
  });
  m.call(ProxyAdmin, "upgrade", [m.getParameter("FxUSDPriceOracleProxy"), FxUSDPriceOracleImplementation], {
    id: "FxUSDPriceOracleProxy_upgrade",
  });
  m.call(ProxyAdmin, "upgrade", [m.getParameter("PoolConfigurationProxy"), PoolConfigurationImplementation], {
    id: "PoolConfigurationProxy_upgrade",
  });
  m.call(ProxyAdmin, "upgrade", [m.getParameter("PoolManagerProxy"), PoolManagerImplementation], {
    id: "PoolManagerProxy_upgrade",
  });
  m.call(ProxyAdmin, "upgrade", ["0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8", AaveFundingPoolImplementation], {
    id: "wstETHLong_upgrade",
  });
  m.call(ProxyAdmin, "upgrade", ["0xAB709e26Fa6B0A30c119D8c55B887DeD24952473", AaveFundingPoolImplementation], {
    id: "WBTCLong_upgrade",
  });
  m.call(ProxyAdmin, "upgrade", [m.getParameter("ShortPoolManagerProxy"), ShortPoolManagerImplementation], {
    id: "ShortPoolManagerProxy_upgrade",
  });
  m.call(ProxyAdmin, "upgrade", ["0x25707b9e6690B52C60aE6744d711cf9C1dFC1876", ShortPoolImplementation], {
    id: "WstETHShort_upgrade",
  });
  m.call(ProxyAdmin, "upgrade", ["0xA0cC8162c523998856D59065fAa254F87D20A5b0", ShortPoolImplementation], {
    id: "WBTCShort_upgrade",
  });
  */

  // upgrade facets for router
  const DiamondCutFacet = m.contractAt("DiamondCutFacet", m.getParameter("Router"));
  m.call(DiamondCutFacet, "diamondCut", [
    [
      {
        facetAddress: SavingFxUSDFacet,
        action: 1,
        functionSelectors: [
          SavingFxUSDFacet__factory.createInterface().getFunction("instantRedeemFromFxSave").selector,
        ],
      },
    ],
    ZeroAddress,
    "0x",
  ]);

  // deploy router
  const diamondCuts = [
    {
      facetAddress: m.getParameter("DiamondCutFacet"),
      action: 0,
      functionSelectors: getAllSignatures(DiamondCutFacet__factory.createInterface()),
    },
    {
      facetAddress: m.getParameter("DiamondLoupeFacet"),
      action: 0,
      functionSelectors: getAllSignatures(DiamondLoupeFacet__factory.createInterface()),
    },
    {
      facetAddress: m.getParameter("OwnershipFacet"),
      action: 0,
      functionSelectors: getAllSignatures(OwnershipFacet__factory.createInterface()),
    },
    {
      facetAddress: m.getParameter("RouterManagementFacet"),
      action: 0,
      functionSelectors: getAllSignatures(RouterManagementFacet__factory.createInterface()),
    },
    {
      facetAddress: PositionOperateFacet,
      action: 0,
      functionSelectors: getAllSignatures(PositionOperateFacet__factory.createInterface()),
    },
  ];
  // deploy Router
  const FxMintRouter = m.contract(
    "Diamond",
    [
      diamondCuts,
      {
        owner: owner,
        init: ZeroAddress,
        initCalldata: "0x",
      },
    ],
    { id: "FxMintRouter" }
  );
  // config parameters
  const RouterManagementFacet = m.contractAt("RouterManagementFacet", FxMintRouter);
  m.call(RouterManagementFacet, "approveTarget", [
    m.getParameter("MultiPathConverter"),
    m.getParameter("MultiPathConverter"),
  ]);
  m.call(RouterManagementFacet, "updateRevenuePool", [m.getParameter("RevenuePool")]);

  return {
    FxUSDBasePoolImplementation,
    FxUSDPriceOracleImplementation,
    PoolConfigurationImplementation,
    AaveFundingPoolImplementation,
    PoolManagerImplementation,
    ShortPoolManagerImplementation,
    ShortPoolImplementation,
  };
});
