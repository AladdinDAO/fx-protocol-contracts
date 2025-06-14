import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import { ethers } from "ethers";

dotenv.config();

const testAccounts = process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
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
  },
  networks: {
    mainnet: {
      url: process.env.MAINNET_RPC_URL || "https://eth.llamarpc.com",
      chainId: 1,
      accounts: [process.env.PRIVATE_KEY_MAINNET!],
      ignition: {
        maxPriorityFeePerGas: ethers.parseUnits("0.01", "gwei"),
        maxFeePerGasLimit: ethers.parseUnits("100", "gwei"),
      },
    },
    base: {
      url: process.env.BASE_RPC_URL || "https://base.llamarpc.com",
      chainId: 8453,
      accounts: [process.env.PRIVATE_KEY_BASE!],
    },
    hermez: {
      url: process.env.HERMEZ_RPC_URL || "https://zkevm-rpc.com",
      chainId: 1101,
      accounts: [process.env.PRIVATE_KEY_HERMEZ!],
    },
    sepolia: {
      url: "https://sepolia.gateway.tenderly.co",
      chainId: 11155111,
      accounts: testAccounts,
    },
    phalcon: {
      url: `https://rpc.phalcon.blocksec.com/${process.env.PHALCON_RPC_ID || ""}`,
      chainId: parseInt(process.env.PHALCON_CHAIN_ID || "1"),
      accounts: testAccounts,
    },
    tenderly_ethereum: {
      url: `https://virtual.mainnet.rpc.tenderly.co/${process.env.TENDERLY_ETHEREUM_RPC_ID || ""}`,
      chainId: parseInt(process.env.TENDERLY_ETHEREUM_CHAIN_ID || "1"),
      accounts: testAccounts,
      ignition: {
        maxPriorityFeePerGas: ethers.parseUnits("0.01", "gwei"),
      },
    },
    tenderly_base: {
      url: `https://virtual.base.rpc.tenderly.co/${process.env.TENDERLY_BASE_RPC_ID || ""}`,
      chainId: parseInt(process.env.TENDERLY_BASE_CHAIN_ID || "1"),
      accounts: [process.env.PRIVATE_KEY_BASE!],
      ignition: {
        maxPriorityFeePerGas: ethers.parseUnits("0.01", "gwei"),
      },
    },
  },
  typechain: {
    outDir: "./src/@types",
    target: "ethers-v6",
  },
  ignition: {
    blockPollingInterval: 1_000,
    timeBeforeBumpingFees: 3 * 60 * 1_000,
    maxFeeBumps: 3,
    disableFeeBumping: false,
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      hermez: process.env.POLYGON_SCAN_API_KEY || "",
      base: process.env.BASE_SCAN_API_KEY || "",
      phalcon: process.env.PHALCON_FORK_ACCESS_KEY || "",
      tenderly_ethereum: process.env.TENDERLY_ACCESS_TOKEN || "",
      tenderly_base: process.env.TENDERLY_ACCESS_TOKEN || "",
    },
    customChains: [
      {
        network: "hermez",
        chainId: 1101,
        urls: {
          apiURL: "https://api-zkevm.polygonscan.com/api",
          browserURL: "https://zkevm.polygonscan.com",
        },
      },
      {
        network: "phalcon",
        chainId: parseInt(process.env.PHALCON_CHAIN_ID || "1"),
        urls: {
          apiURL: `https://api.phalcon.xyz/api/${process.env.PHALCON_RPC_ID || ""}`,
          browserURL: `https://scan.phalcon.xyz/${process.env.PHALCON_FORK_ID || ""}`,
        },
      },
      {
        network: "tenderly_ethereum",
        chainId: parseInt(process.env.TENDERLY_ETHEREUM_CHAIN_ID || "1"),
        urls: {
          apiURL: `https://virtual.mainnet.rpc.tenderly.co/${process.env.TENDERLY_ETHEREUM_RPC_ID || ""}/verify/etherscan`,
          browserURL: `https://dashboard.tenderly.co/${process.env.TENDERLY_USERNAME}/${process.env.TENDERLY_PROJECT}/testnet/${process.env.TENDERLY_ETHEREUM_TESTNET_ID}/contract/virtual/`,
        },
      },
      {
        network: "tenderly_base",
        chainId: parseInt(process.env.TENDERLY_BASE_CHAIN_ID || "1"),
        urls: {
          apiURL: `https://virtual.base.rpc.tenderly.co/${process.env.TENDERLY_BASE_RPC_ID || ""}/verify/etherscan`,
          browserURL: `https://dashboard.tenderly.co/${process.env.TENDERLY_USERNAME}/${process.env.TENDERLY_PROJECT}/testnet/${process.env.TENDERLY_BASE_TESTNET_ID}/contract/virtual/`,
        },
      },
    ],
  },
  paths: {
    artifacts: "./artifacts-hardhat",
    cache: "./cache-hardhat",
    sources: "./contracts",
    tests: "./test",
  },
  sourcify: {
    enabled: false,
  },
  mocha: {
    timeout: 400000,
  },
};

export default config;
