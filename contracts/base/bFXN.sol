// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

contract bFXN is AccessControlUpgradeable, ERC20Upgradeable {
  bytes32 constant MINTER_ROLE = keccak256("MINTER_ROLE");

  function initialize(string memory _name, string memory _symbol) external initializer {
    __Context_init(); // from ContextUpgradeable
    __ERC20_init(_name, _symbol); // from ERC20Upgradeable
    __ERC165_init(); // from ERC165Upgradeable
    __AccessControl_init(); // from AccessControlUpgradeable

    // grant access
    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
    _mint(to, amount);
  }
}
