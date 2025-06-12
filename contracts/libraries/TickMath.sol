// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

library TickMath {
  /// The minimum tick that can be passed in getRatioAtTick. 1.0015**-32767
  int24 internal constant MIN_TICK = -32767;
  /// The maximum tick that can be passed in getRatioAtTick. 1.0015**32767
  int24 internal constant MAX_TICK = 32767;

  uint256 internal constant NEGATIVE_MASK = 0x8000000000000000000000000000000000000000000000000000000000000000;

  uint256 internal constant SCALAR00 = 0x100000000000000000000000000000000;
  uint256 internal constant SCALAR01 = 0xff9dd7de423466c20352b1246ce4856f; // 2^128/1.0015**1 = 339772707859149738855091969477551883631
  uint256 internal constant SCALAR02 = 0xff3bd55f4488ad277531fa1c725a66d0; // 2^128/1.0015**2 = 339263812140938331358054887146831636176
  uint256 internal constant SCALAR03 = 0xfe78410fd6498b73cb96a6917f853259; // 2^128/1.0015**4 = 338248306163758188337119769319392490073
  uint256 internal constant SCALAR04 = 0xfcf2d9987c9be178ad5bfeffaa123273; // 2^128/1.0015**8 = 336226404141693512316971918999264834163
  uint256 internal constant SCALAR05 = 0xf9ef02c4529258b057769680fc6601b3; // 2^128/1.0015**16 = 332218786018727629051611634067491389875
  uint256 internal constant SCALAR06 = 0xf402d288133a85a17784a411f7aba082; // 2^128/1.0015**32 = 324346285652234375371948336458280706178
  uint256 internal constant SCALAR07 = 0xe895615b5beb6386553757b0352bda90; // 2^128/1.0015**64 = 309156521885964218294057947947195947664
  uint256 internal constant SCALAR08 = 0xd34f17a00ffa00a8309940a15930391a; // 2^128/1.0015**128 = 280877777739312896540849703637713172762
  uint256 internal constant SCALAR09 = 0xae6b7961714e20548d88ea5123f9a0ff; // 2^128/1.0015**256 = 231843708922198649176471782639349113087
  uint256 internal constant SCALAR10 = 0x76d6461f27082d74e0feed3b388c0ca1; // 2^128/1.0015**512 = 157961477267171621126394973980180876449
  uint256 internal constant SCALAR11 = 0x372a3bfe0745d8b6b19d985d9a8b85bb; // 2^128/1.0015**1024 = 73326833024599564193373530205717235131
  uint256 internal constant SCALAR12 = 0x0be32cbee48979763cf7247dd7bb539d; // 2^128/1.0015**2048 = 15801066890623697521348224657638773661
  uint256 internal constant SCALAR13 = 0x8d4f70c9ff4924dac37612d1e2921e; // 2^128/1.0015**4096 = 733725103481409245883800626999235102
  uint256 internal constant SCALAR14 = 0x4e009ae5519380809a02ca7aec77; // 2^128/1.0015**8192 = 1582075887005588088019997442108535
  uint256 internal constant SCALAR15 = 0x17c45e641b6e95dee056ff10; // 2^128/1.0015**16384 = 7355550435635883087458926352

  /// The minimum value that can be returned from getRatioAtTick. Equivalent to getRatioAtTick(MIN_TICK). ~ Equivalent to `(1 << 96) * (1.0015**-32767)`
  uint256 internal constant MIN_TICK_RATIO = 37075071;
  /// The maximum value that can be returned from getRatioAtTick. Equivalent to getRatioAtTick(MAX_TICK).
  /// ~ Equivalent to `(1 << 96) * (1.0015**32767)`, rounding etc. leading to minor difference
  uint256 internal constant MAX_TICK_RATIO = 169307877264527972847801929085841449095838922544595;

  uint256 internal constant ZERO_TICK_SCALED_RATIO = 0x1000000000000000000000000; // 1 << 96 // 79228162514264337593543950336
  uint256 internal constant PRECISION = 1e26;

  /// @notice ratioX96 = (1.0015^tick) * 2^96
  /// @dev Throws if |tick| > max tick
  /// @param tick The input tick for the above formula
  /// @return ratioX96 ratio = (debt amount/collateral amount)
  function getRatioAtTick(int tick) internal pure returns (uint256 ratioX96) {
    assembly {
      let tickAbs := tick
      if and(tick, NEGATIVE_MASK) {
        tickAbs := sub(0, tick)
      }

      if gt(tickAbs, MAX_TICK) {
        revert(0, 0)
      }
      let value_ := SCALAR00
      if and(tickAbs, 0x1) {
        value_ := SCALAR01
      }
      if and(tickAbs, 0x2) {
        value_ := shr(128, mul(value_, SCALAR02))
      }
      if and(tickAbs, 0x4) {
        value_ := shr(128, mul(value_, SCALAR03))
      }
      if and(tickAbs, 0x8) {
        value_ := shr(128, mul(value_, SCALAR04))
      }
      if and(tickAbs, 0x10) {
        value_ := shr(128, mul(value_, SCALAR05))
      }
      if and(tickAbs, 0x20) {
        value_ := shr(128, mul(value_, SCALAR06))
      }
      if and(tickAbs, 0x40) {
        value_ := shr(128, mul(value_, SCALAR07))
      }
      if and(tickAbs, 0x80) {
        value_ := shr(128, mul(value_, SCALAR08))
      }
      if and(tickAbs, 0x100) {
        value_ := shr(128, mul(value_, SCALAR09))
      }
      if and(tickAbs, 0x200) {
        value_ := shr(128, mul(value_, SCALAR10))
      }
      if and(tickAbs, 0x400) {
        value_ := shr(128, mul(value_, SCALAR11))
      }
      if and(tickAbs, 0x800) {
        value_ := shr(128, mul(value_, SCALAR12))
      }
      if and(tickAbs, 0x1000) {
        value_ := shr(128, mul(value_, SCALAR13))
      }
      if and(tickAbs, 0x2000) {
        value_ := shr(128, mul(value_, SCALAR14))
      }
      if and(tickAbs, 0x4000) {
        value_ := shr(128, mul(value_, SCALAR15))
      }

      let precision_ := 0
      if iszero(and(tick, NEGATIVE_MASK)) {
        value_ := div(0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff, value_)
        // we round up in the division so getTickAtRatio of the output price is always consistent
        if mod(value_, 0x100000000) {
          precision_ := 1
        }
      }
      ratioX96 := add(shr(32, value_), precision_)
    }
  }

  /// @notice ratioX96 = (1.0015^tick) * 2^96
  /// @dev Throws if ratioX96 > max ratio || ratioX96 < min ratio
  /// @param ratioX96 The input ratio; ratio = (debt amount/collateral amount)
  /// @return tick The output tick for the above formula. Returns in round down form. if tick is 123.23 then 123, if tick is -123.23 then returns -124
  /// @return perfectRatioX96 perfect ratio for the above tick
  function getTickAtRatio(uint256 ratioX96) internal pure returns (int tick, uint perfectRatioX96) {
    assembly {
      if or(gt(ratioX96, MAX_TICK_RATIO), lt(ratioX96, MIN_TICK_RATIO)) {
        revert(0, 0)
      }

      let tickIsNegative := lt(ratioX96, ZERO_TICK_SCALED_RATIO)
      let value_

      switch tickIsNegative
      case 0 {
        // if ratioX96 >= ZERO_TICK_SCALED_RATIO
        value_ := div(mul(ratioX96, PRECISION), ZERO_TICK_SCALED_RATIO)
      }
      default {
        // ratioX96 < ZERO_TICK_SCALED_RATIO
        value_ := div(mul(ZERO_TICK_SCALED_RATIO, PRECISION), ratioX96)
      }

      // use `getRatioAtTick(tick)` to get `(1.0015^tick) * 2^96`
      // and use python to get the value of `getRatioAtTick(tick) * 10^26 / 79228162514264337593543950336`

      // for tick = 2^14
      // ratioX96 = (1.0015^16384) * 2^96 = 3665252098134783297721995888541655517464
      // 3665252098134783297721995888541655517464 * 10^26 / 79228162514264337593543950336 = 
      // 4626198540796508716348404308351034442.59912669744680855913628167
      if iszero(lt(value_, 4626198540796508716348404308351034442)) {
        tick := or(tick, 0x4000)
        value_ := div(mul(value_, PRECISION), 4626198540796508716348404308351034442)
      }
      // for tick = 2^13
      // ratioX96 = (1.0015^8192) * 2^96 = 17040868196391020479062776466509866
      // 17040868196391020479062776466509866 * 10^26 / 79228162514264337593543950336 = 
      // 21508599537851153911767490449162.30388433471560772971058422
      if iszero(lt(value_, 21508599537851153911767490449162)) {
        tick := or(tick, 0x2000)
        value_ := div(mul(value_, PRECISION), 21508599537851153911767490449162)
      }
      // for tick = 2^12
      // ratioX96 = (1.0015^4096) * 2^96 = 36743933851015821532611831851151
      // 36743933851015821532611831851151 * 10^26 / 79228162514264337593543950336 = 
      // 46377364670549310883002866648.97849117190913404467057871
      if iszero(lt(value_, 46377364670549310883002866648)) {
        tick := or(tick, 0x1000)
        value_ := div(mul(value_, PRECISION), 46377364670549310883002866648)
      }
      // for tick = 2^11
      // ratioX96 = (1.0015^2048) * 2^96 = 1706210527034005899209104452336
      // 1706210527034005899209104452336 * 10^26 / 79228162514264337593543950336 =
      // 2153540449365864845468344760.06441018972143364324249494
      if iszero(lt(value_, 2153540449365864845468344760)) {
        tick := or(tick, 0x800)
        value_ := div(mul(value_, PRECISION), 2153540449365864845468344760)
      }
      // for tick = 2^10
      // ratioX96 = (1.0015^1024) * 2^96 = 367668226692760093024536487237
      // 367668226692760093024536487237 * 10^26 / 79228162514264337593543950336 =
      // 464062544207767844008185024.95183649344791541594882857
      if iszero(lt(value_, 464062544207767844008185024)) {
        tick := or(tick, 0x400)
        value_ := div(mul(value_, PRECISION), 464062544207767844008185024)
      }
      // for tick = 2^9
      // ratioX96 = (1.0015^512) * 2^96 = 170674186729409605620119663669
      // 170674186729409605620119663669 * 10^26 / 79228162514264337593543950336 =
      // 215421109505955298802281577.03291187458466714140583746
      if iszero(lt(value_, 215421109505955298802281577)) {
        tick := or(tick, 0x200)
        value_ := div(mul(value_, PRECISION), 215421109505955298802281577)
      }
      // for tick = 2^8
      // ratioX96 = (1.0015^256) * 2^96 = 116285004205991934861656513302
      // 116285004205991934861656513302 * 10^26 / 79228162514264337593543950336 =
      // 146772309890508740607270614.66786113800638440233092948
      if iszero(lt(value_, 146772309890508740607270614)) {
        tick := or(tick, 0x100)
        value_ := div(mul(value_, PRECISION), 146772309890508740607270614)
      }
      // for tick = 2^7
      // ratioX96 = (1.0015^128) * 2^96 = 95984619659632141743747099591
      // 95984619659632141743747099591 * 10^26 / 79228162514264337593543950336 =
      // 121149622323187099817270416.15833126823570458129564582
      if iszero(lt(value_, 121149622323187099817270416)) {
        tick := or(tick, 0x80)
        value_ := div(mul(value_, PRECISION), 121149622323187099817270416)
      }
      // for tick = 2^6
      // ratioX96 = (1.0015^64) * 2^96 = 87204845308406958006717891125
      // 87204845308406958006717891125 * 10^26 / 79228162514264337593543950336 =
      // 110067989135437147685980801.56915296006152089117457608
      if iszero(lt(value_, 110067989135437147685980801)) {
        tick := or(tick, 0x40)
        value_ := div(mul(value_, PRECISION), 110067989135437147685980801)
      }
      // for tick = 2^5
      // ratioX96 = (1.0015^32) * 2^96 = 83120873769022354029916374476
      // 83120873769022354029916374476 * 10^26 / 79228162514264337593543950336 =
      // 104913292358707887270979599.83188521036790476918243160
      if iszero(lt(value_, 104913292358707887270979599)) {
        tick := or(tick, 0x20)
        value_ := div(mul(value_, PRECISION), 104913292358707887270979599)
      }
      // for tick = 2^4
      // ratioX96 = (1.0015^16) * 2^96 = 81151180492336368327184716177
      // 81151180492336368327184716177 * 10^26 / 79228162514264337593543950336 =
      // 102427189924701091191840927.76289018827089975214307641
      if iszero(lt(value_, 102427189924701091191840927)) {
        tick := or(tick, 0x10)
        value_ := div(mul(value_, PRECISION), 102427189924701091191840927)
      }
      // for tick = 2^3
      // ratioX96 = (1.0015^8) * 2^96 = 80183906840906820640659903621
      // 80183906840906820640659903621 * 10^26 / 79228162514264337593543950336 =
      // 101206318935480056907421312.89064558712400350960439215
      if iszero(lt(value_, 101206318935480056907421312)) {
        tick := or(tick, 0x8)
        value_ := div(mul(value_, PRECISION), 101206318935480056907421312)
      }
      // for tick = 2^2
      // ratioX96 = (1.0015^4) * 2^96 = 79704602139525152702959747604
      // 79704602139525152702959747604 * 10^26 / 79228162514264337593543950336 =
      // 100601351350506250000000000.00093883057718280672865438
      if iszero(lt(value_, 100601351350506250000000000)) {
        tick := or(tick, 0x4)
        value_ := div(mul(value_, PRECISION), 100601351350506250000000000)
      }
      // for tick = 2^1
      // ratioX96 = (1.0015^2) * 2^96 = 79466025265172787701084167661
      // 79466025265172787701084167661 * 10^26 / 79228162514264337593543950336 =
      // 100300225000000000000000000.00013094333720199783798501
      if iszero(lt(value_, 100300225000000000000000000)) {
        tick := or(tick, 0x2)
        value_ := div(mul(value_, PRECISION), 100300225000000000000000000)
      }
      // for tick = 2^0
      // ratioX96 = (1.0015^1) * 2^96 = 79347004758035734099934266262
      // 79347004758035734099934266262 * 10^26 / 79228162514264337593543950336 =
      // 100150000000000000000000000.00062604001438339496877474
      if iszero(lt(value_, 100150000000000000000000000)) {
        tick := or(tick, 0x1)
        value_ := div(mul(value_, PRECISION), 100150000000000000000000000)
      }

      switch tickIsNegative
      case 0 {
        // if ratioX96 >= ZERO_TICK_SCALED_RATIO
        perfectRatioX96 := div(mul(ratioX96, PRECISION), value_)
      }
      default {
        // ratioX96 < ZERO_TICK_SCALED_RATIO
        tick := not(tick)
        perfectRatioX96 := div(mul(ratioX96, value_), 100150000000000000000000000)
      }

      // perfect ratio should always be <= ratioX96
      // not sure if it can ever be bigger but better to have extra checks
      if gt(perfectRatioX96, ratioX96) {
        revert(0, 0)
      }
    }
  }
}
