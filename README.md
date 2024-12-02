# f(x) protocol contracts

This repo contains smart contracts for f(x) protocol v2.

## Tests

- hardhat tests: `yarn test:hardhat`
- foundry tests: `yarn test:foundry`
- simulation tests: `yarn test:simulation`
- coverage: `yarn coverage`

## Deployment

```bash
npx hardhat ignition deploy ignition/modules/pools/WstETHPool.ts --network <network> --parameters <parameters>
npx hardhat ignition deploy ignition/modules/Router.ts --network <network> --parameters <parameters>
npx hardhat ignition deploy ignition/modules/Migration.ts --network <network> --parameters <parameters>
```

## Verify

```
npx hardhat ignition verify --include-unrelated-contracts
```
