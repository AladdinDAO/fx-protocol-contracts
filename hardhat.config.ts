import * as dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

const testAccounts = process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    compilers: [
      {
        version: "0.8.26",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "cancun",
        },
      },
    ],
    overrides: {
      "contracts/core/PoolManager.sol": {
        version: "0.8.26",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
          evmVersion: "cancun",
        },
      },
    },
  },
  networks: {
    mainnet: {
      type: "http",
      url: process.env.MAINNET_RPC_URL || "https://rpc.ankr.com/eth",
      chainId: 1,
      accounts: [process.env.PRIVATE_KEY_MAINNET!],
      ignition: {
        maxPriorityFeePerGas: ethers.parseUnits("0.01", "gwei"),
        maxFeePerGasLimit: ethers.parseUnits("100", "gwei"),
      },
    },
    hermez: {
      type: "http",
      url: process.env.HERMEZ_RPC_URL || "https://zkevm-rpc.com",
      chainId: 1101,
      accounts: [process.env.PRIVATE_KEY_HERMEZ!],
    },
    sepolia: {
      type: "http",
      url: "https://sepolia.gateway.tenderly.co",
      chainId: 11155111,
      accounts: testAccounts,
    },
    phalcon: {
      type: "http",
      url: `https://rpc.phalcon.blocksec.com/${process.env.PHALCON_RPC_ID || ""}`,
      chainId: parseInt(process.env.PHALCON_CHAIN_ID || "1"),
      accounts: testAccounts,
    },
    tenderly: {
      type: "http",
      url: `https://virtual.mainnet.rpc.tenderly.co/${process.env.TENDERLY_ETHEREUM_RPC_ID || ""}`,
      chainId: parseInt(process.env.TENDERLY_ETHEREUM_CHAIN_ID || "1"),
      accounts: testAccounts,
      ignition: {
        maxPriorityFeePerGas: ethers.parseUnits("0.01", "gwei"),
      },
    },
  },
  typechain: {
    outDir: "./src/@types",
  },
  ignition: {
    blockPollingInterval: 1_000,
    timeBeforeBumpingFees: 3 * 60 * 1_000,
    maxFeeBumps: 3,
    disableFeeBumping: false,
  },
  verify: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY || "",
      enabled: false,
    },
    blockscout: {
      enabled: true,
    },
  },
  paths: {
    artifacts: "./artifacts-hardhat",
    cache: "./cache-hardhat",
    sources: "./contracts",
    tests: "./test",
  },
};

export default config;
