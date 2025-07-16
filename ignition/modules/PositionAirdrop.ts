import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("PositionAirdrop", (m) => {
  const airdrop = m.contract("PositionAirdrop", ["0xa1d0027Ca4C0CB79f9403d06A29470abC7b0a468"]);
  return { airdrop };
});
