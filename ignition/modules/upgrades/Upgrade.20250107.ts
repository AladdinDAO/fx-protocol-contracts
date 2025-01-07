import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("Upgrade20250107", (m) => {
  // deploy PoolManager implementation
  const PoolManagerImplementation = m.contract(
    "PoolManager",
    [m.getParameter("FxUSDProxy"), m.getParameter("FxUSDBasePoolProxy"), m.getParameter("PegKeeperProxy")],
    {
      id: "PoolManagerImplementation",
    }
  );

  // deploy AaveFundingPool implementation
  const AaveFundingPoolImplementation = m.contract(
    "AaveFundingPool",
    [m.getParameter("PoolManagerProxy"), m.getParameter("LendingPool"), m.getParameter("BaseAsset")],
    { id: "AaveFundingPoolImplementation" }
  );

  return { AaveFundingPoolImplementation, PoolManagerImplementation };
});
