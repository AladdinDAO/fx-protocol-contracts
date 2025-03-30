// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { IFxUSDRegeneracy } from "../interfaces/IFxUSDRegeneracy.sol";
import { IPegKeeper } from "../interfaces/IPegKeeper.sol";

import { Math } from "../libraries/Math.sol";

contract L2FxUSD is AccessControlUpgradeable, ERC20PermitUpgradeable, IFxUSDRegeneracy {
  using SafeERC20 for IERC20;
  using EnumerableSet for EnumerableSet.AddressSet;

  /**********
   * Errors *
   **********/

  error ErrorCallerNotPoolManager();

  error ErrorCallerNotPegKeeper();

  error ErrorExceedStableReserve();

  error ErrorInsufficientOutput();

  error ErrorInsufficientBuyBack();

  /*************
   * Constants *
   *************/

  /// @dev The precision used to compute nav.
  uint256 private constant PRECISION = 1e18;

  /***********
   * Structs *
   ***********/

  /// @dev The struct for stable token reserve.
  /// @param owned The number of stable coins owned in this contract.
  /// @param managed The amount of fxUSD managed under this stable coin.
  /// @param enabled Whether this stable coin is enabled, currently always true
  /// @param decimals The decimal for the stable coin.
  /// @param reserved Reserved slots for future usage.
  struct StableReserveStruct {
    uint96 owned;
    uint96 managed;
    uint8 decimals;
  }

  /***********************
   * Immutable Variables *
   ***********************/

  /// @inheritdoc IFxUSDRegeneracy
  address public immutable poolManager;

  /// @inheritdoc IFxUSDRegeneracy
  address public immutable stableToken;

  /// @inheritdoc IFxUSDRegeneracy
  address public immutable pegKeeper;

  /*********************
   * Storage Variables *
   *********************/

  /// @notice The reserve struct for stable token.
  StableReserveStruct public stableReserve;

  /*************
   * Modifiers *
   *************/

  modifier onlyPoolManager() {
    if (_msgSender() != poolManager) revert ErrorCallerNotPoolManager();
    _;
  }

  modifier onlyPegKeeper() {
    if (_msgSender() != pegKeeper) revert ErrorCallerNotPegKeeper();
    _;
  }

  /***************
   * Constructor *
   ***************/

  constructor(address _poolManager, address _stableToken, address _pegKeeper) {
    poolManager = _poolManager;
    stableToken = _stableToken;
    pegKeeper = _pegKeeper;
  }

  function initialize(string memory _name, string memory _symbol) external initializer {
    __Context_init();
    __ERC165_init();
    __AccessControl_init();
    __ERC20_init(_name, _symbol);
    __ERC20Permit_init(_name);

    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());

    stableReserve.decimals = L2FxUSD(stableToken).decimals();
  }

  /*************************
   * Public View Functions *
   *************************/

  /****************************
   * Public Mutated Functions *
   ****************************/

  /// @inheritdoc IFxUSDRegeneracy
  function mint(address to, uint256 amount) external onlyPoolManager {
    _mint(to, amount);
  }

  /// @inheritdoc IFxUSDRegeneracy
  function burn(address from, uint256 amount) external onlyPoolManager {
    _burn(from, amount);
  }

  /// @inheritdoc IFxUSDRegeneracy
  function onRebalanceWithStable(uint256 amountStableToken, uint256 amountFxUSD) external onlyPoolManager {
    stableReserve.owned += uint96(amountStableToken);
    stableReserve.managed += uint96(amountFxUSD);

    emit RebalanceWithStable(amountStableToken, amountFxUSD);
  }

  /// @inheritdoc IFxUSDRegeneracy
  function buyback(
    uint256 amountIn,
    address receiver,
    bytes calldata data
  ) external onlyPegKeeper returns (uint256 amountOut, uint256 bonusOut) {
    StableReserveStruct memory cachedStableReserve = stableReserve;
    if (amountIn > cachedStableReserve.owned) revert ErrorExceedStableReserve();

    // rounding up
    uint256 expectedFxUSD = Math.mulDivUp(amountIn, cachedStableReserve.managed, cachedStableReserve.owned);

    // convert USDC to fxUSD
    IERC20(stableToken).safeTransfer(pegKeeper, amountIn);
    uint256 actualOut = balanceOf(address(this));
    amountOut = IPegKeeper(pegKeeper).onSwap(stableToken, address(this), amountIn, data);
    actualOut = balanceOf(address(this)) - actualOut;

    // check actual fxUSD swapped in case peg keeper is hacked.
    if (amountOut > actualOut) revert ErrorInsufficientOutput();

    // check fxUSD swapped can cover debts
    if (amountOut < expectedFxUSD) revert ErrorInsufficientBuyBack();
    bonusOut = amountOut - expectedFxUSD;

    _burn(address(this), expectedFxUSD);
    unchecked {
      cachedStableReserve.owned -= uint96(amountIn);
      if (cachedStableReserve.managed > expectedFxUSD) {
        cachedStableReserve.managed -= uint96(expectedFxUSD);
      } else {
        cachedStableReserve.managed = 0;
      }
      stableReserve = cachedStableReserve;
    }

    if (bonusOut > 0) {
      _transfer(address(this), receiver, bonusOut);
    }

    emit Buyback(amountIn, amountOut, bonusOut);
  }
}
