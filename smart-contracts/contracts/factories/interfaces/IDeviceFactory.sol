// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISmartClawsDevice} from "../../interfaces/ISmartClawsDevice.sol";
import {IChannelFactory} from "./IChannelFactory.sol";

/**
 * @title IDeviceFactory
 * @notice Deploys SmartClawsDevice instances on behalf of a caller.
 * @dev The device provisions its own channels, so it receives the channel
 *      factory it should delegate that work to.
 */
interface IDeviceFactory {
    function createDevice(
        address group,
        address deviceAdmin,
        address registry,
        IChannelFactory channelFactory,
        uint256 capacity,
        string calldata deviceId
    ) external returns (ISmartClawsDevice device);
}
