import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("Upgrade20250721", (m) => {
  // deploy PoolManager implementation
  const PoolManagerImplementation = m.contract(
    "PoolManager",
    [
      m.getParameter("FxUSDProxy"),
      m.getParameter("FxUSDBasePoolProxy"),
      m.getParameter("ShortPoolManagerProxy"),
      m.getParameter("PoolConfigurationProxy"),
    ],
    {
      id: "PoolManagerImplementation",
    }
  );

  // deploy AaveFundingPool implementation
  const AaveFundingPoolImplementation = m.contract(
    "AaveFundingPool",
    [m.getParameter("PoolManagerProxy"), m.getParameter("PoolConfigurationProxy")],
    {
      id: "AaveFundingPoolImplementation",
    }
  );

  // deploy ShortPoolManager implementation
  const ShortPoolManagerImplementation = m.contract(
    "ShortPoolManager",
    [m.getParameter("FxUSDProxy"), m.getParameter("PoolManagerProxy"), m.getParameter("PoolConfigurationProxy")],
    {
      id: "ShortPoolManagerImplementation",
    }
  );

  // deploy ShortPool implementation
  const ShortPoolImplementation = m.contract(
    "ShortPool",
    [m.getParameter("ShortPoolManagerProxy"), m.getParameter("PoolConfigurationProxy")],
    {
      id: "ShortPoolImplementation",
    }
  );

  return {
    PoolManagerImplementation,
    AaveFundingPoolImplementation,
    ShortPoolManagerImplementation,
    ShortPoolImplementation,
  };
});
