// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import { IGovernanceToken } from "./interfaces/IGovernanceToken.sol";

contract bFXN is ERC20Upgradeable, IGovernanceToken {
  /**********
   * Errors *
   **********/

  /// @dev Thrown when caller is not the minter.
  error ErrorNotMinter();

  /***********************
   * Immutable Variables *
   ***********************/
  
  /// @notice The address of minter.
  address public immutable minter;

  /***************
   * Constructor *
   ***************/

  constructor(address _minter) {
    minter = _minter;
  }

  function initialize(string memory _name, string memory _symbol) external initializer {
    __Context_init(); // from ContextUpgradeable
    __ERC20_init(_name, _symbol); // from ERC20Upgradeable
  }

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IGovernanceToken
  function mint(address to, uint256 amount) external {
    if (minter != _msgSender()) revert ErrorNotMinter();

    _mint(to, amount);
  }
}
