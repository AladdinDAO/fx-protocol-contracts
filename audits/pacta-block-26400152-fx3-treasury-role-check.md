# f(x) v2 ProtocolTreasury AccessControl Verification (Block 26400152)

## Summary of Finding FX3 (Provided Upfront)
While `LongPoolManager` (`0x250893CA4ba5d05626C785e8da758026928FCD24`) and `ShortPoolManager` (`0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D`) assign `DEFAULT_ADMIN_ROLE` (`0x0000000000000000000000000000000000000000000000000000000000000000`) to the 3-day `Timelock` (`0x68863fb8855b04509a835082478D6E3D0bE4E61a`) and restrict the 3-of-4 `EmergencySafe` (`0x28c921adAC4c1072658eB01a28DA06b5F651eF62`) to `EMERGENCY_ROLE` (`0xbf233dd2aafeb4d50879c4aa5c81e96d92f6e6945c906a58f9f2d1c1631b4b26`), all 4 live v2 `ProtocolTreasury` proxies at Ethereum block `26400152` currently grant `DEFAULT_ADMIN_ROLE` directly to `EmergencySafe` (3-of-4) and `OpsSafe` (`0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF`, 6-of-9), while `Timelock` holds `false` (`0`):

- `0x32356FE312Eba9B7D6A157ad28D1ca91b571CdA6` (`hasRole(0x00..00, EmergencySafe) == true`, `hasRole(0x00..00, Timelock) == false`)
- `0xb178197E88D58Da21bE22A408E850d1e6Dc09A38` (`hasRole(0x00..00, EmergencySafe) == true`, `hasRole(0x00..00, Timelock) == false`)
- `0x6D9e81c5b7C4b37d0Fe9E8CDA776e057f4040868` (`hasRole(0x00..00, EmergencySafe) == true`, `hasRole(0x00..00, Timelock) == false`)
- `0x87d5e4cAaF4358A4337C10859c7107c7AEF4f8Ce` (`hasRole(0x00..00, EmergencySafe) == true`, `hasRole(0x00..00, Timelock) == false`)

Because `ProtocolTreasury` (`0x253d0C045eE4fB6F2707Fe7d1Fcd0ef036E032A9`) inherits `PermissionedSwap.withdraw(address baseToken, address recipient) onlyRole(DEFAULT_ADMIN_ROLE)`, `DEFAULT_ADMIN_ROLE` authorizes direct ERC-20 withdrawal outside the 3-day Timelock.
