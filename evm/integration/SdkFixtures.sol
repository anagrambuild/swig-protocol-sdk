// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.35;

import {SwigConfigActions} from "./SwigConfig/SwigConfigActions.sol";

contract SdkCodecHarness {
    function validateAction(uint8 permission, bytes memory data) external pure {
        SwigConfigActions.validateAction(permission, data);
    }
}

contract SdkTarget {
    uint256 public count;
    function ping() external { count++; }
}

contract SdkToken {
    mapping(address => uint256) public balanceOf;
    function mint(address account, uint256 amount) external { balanceOf[account] += amount; }
    function transfer(address recipient, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}
