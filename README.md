# f(x) protocol contracts

This repo contains smart contracts for f(x) protocol v2.
Deployment scripts are base on Base branch deployments.

## Deployment on BSC forking

```bash
npx hardhat ignition deploy ignition/modules/BSC.ts --parameters ignition/parameters/bsc.json --network hardhat --write-localhost-deployment
```

## Verify

```
npx hardhat ignition verify --include-unrelated-contracts
```
