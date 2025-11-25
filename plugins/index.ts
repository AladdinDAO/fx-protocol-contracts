import { task } from "hardhat/config";
import type { HardhatPlugin } from "hardhat/types/plugins";

import "./type-extensions.js";

const FxProtocolPlugin: HardhatPlugin = {
  id: "fx-protocol-contracts-plugin",
  hookHandlers: {},
  tasks: [
    task("mock-owner", "Mock owner")
      .addOption({
        name: "owner",
        description: "The address of the owner",
        defaultValue: "0xa1d0027Ca4C0CB79f9403d06A29470abC7b0a468",
      })
      .setAction(() => import("./tasks/mock-owner.ts"))
      .build(),
  ],
};

export default FxProtocolPlugin;
