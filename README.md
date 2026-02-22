# f(x) protocol contracts

This repo contains smart contracts for f(x) protocol v2.

## Tests

- hardhat tests: `yarn test:hardhat`
- foundry tests: `yarn test:foundry`
- simulation tests: `yarn test:simulation`
- coverage: `yarn coverage`

## Deployment
```bash
yarn hardhat --network tenderly ignition deploy ignition/modules/FxUSD.ts --deployment-id katana --parameters ignition/parameters/katana.json
```
Deploy FxUSD-USDC sushi pool and fill it in the katana parameters.
```bash
yarn hardhat --network tenderly ignition deploy ignition/modules/KatanaFxMint.ts --deployment-id katana --parameters ignition/parameters/katana.json 
```

## Verify

```
npx hardhat ignition verify --include-unrelated-contracts
```
