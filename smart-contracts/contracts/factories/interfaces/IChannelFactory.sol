// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISmartClawsChannel} from "../../interfaces/ISmartClawsChannel.sol";

/**
 * @title IChannelFactory
 * @notice Deploys SmartClawsChannel instances on behalf of a caller.
 */
interface IChannelFactory {
    function createChannel(
        address initialOwner,
        uint256 maxCapacityBytes,
        address registry
    ) external returns (ISmartClawsChannel channel);
}
