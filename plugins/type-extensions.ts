import "hardhat/types/config";
declare module "hardhat/types/config" {
  export interface EdrNetworkUserConfig {
    myAccountIndex?: number;
  }

  export interface EdrNetworkConfig {
    myAccountIndex: number;
  }

  export interface HttpNetworkUserConfig {
    myAccountIndex?: number;
  }

  export interface HttpNetworkConfig {
    myAccountIndex: number;
  }
}

import "hardhat/types/network";
declare module "hardhat/types/network" {
  interface NetworkConnection {
    myAccount: string;
  }
}
