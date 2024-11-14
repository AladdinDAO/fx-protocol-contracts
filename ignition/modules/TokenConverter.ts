import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("TokenConverter", (m) => {
  const MultiPathConverter = m.contract("MultiPathConverter", [m.getParameter("GeneralTokenConverter")]);

  return { MultiPathConverter };
});
