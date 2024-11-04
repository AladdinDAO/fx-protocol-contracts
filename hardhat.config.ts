import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

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
  typechain: {
    outDir: "./scripts/@types",
    target: "ethers-v6",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      hermez: process.env.ETHERSCAN_API_KEY || "",
      phalcon: process.env.PHALCON_FORK_ACCESS_KEY || "",
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
          apiURL: `https://api.phalcon.xyz/api/${
            process.env.PHALCON_RPC_ID || ""
          }`,
          browserURL: `https://scan.phalcon.xyz/${
            process.env.PHALCON_FORK_ID || ""
          }`,
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
  mocha: {
    timeout: 400000,
  },
};

export default config;
