import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { ZeroAddress } from "ethers";

export default buildModule("EmptyContract", (m) => {
  const EmptyContract = m.contract("EmptyContract", []);
  return { EmptyContract };
});
