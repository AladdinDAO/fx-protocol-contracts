// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import { ICreditNote } from "../../interfaces/ICreditNote.sol";

contract CreditNote is ERC20Upgradeable, ICreditNote {
  /**********
   * Errors *
   **********/

  /// @dev Thrown when the caller is not the `PoolManager` contract.
  error ErrorUnauthorized();

  /***********************
   * Immutable Variables *
   ***********************/

  uint8 private _decimal;

  /// @notice The address of the `PoolManager` contract.
  address public immutable poolManager;

  /***************
   * Constructor *
   ***************/

  constructor(address _poolManager) {
    poolManager = _poolManager;
  }

  function initialize(string memory name, string memory symbol, uint8 decimal) external initializer {
    __ERC20_init(name, symbol);

    _decimal = decimal;
  }

  /*************************
   * Public View Functions *
   *************************/

  function decimals() public view virtual override returns (uint8) {
    return _decimal;
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc ICreditNote
  function mint(address to, uint256 amount) external {
    if (msg.sender != poolManager) revert ErrorUnauthorized();

    _mint(to, amount);
  }

  /// @inheritdoc ICreditNote
  function burn(address from, uint256 amount) external {
    if (msg.sender != poolManager) revert ErrorUnauthorized();

    _burn(from, amount);
  }
}
