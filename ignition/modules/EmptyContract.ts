import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

import { ZeroAddress } from "ethers";

export default buildModule("EmptyContract", (m) => {
  const EmptyContract = m.contractAt("EmptyContract", m.getParameter("deployed", ZeroAddress));
  if (EmptyContract.address === ZeroAddress) {
    return { EmptyContract: m.contract("EmptyContract", []) };
  } else {
    return { EmptyContract };
  }
});
