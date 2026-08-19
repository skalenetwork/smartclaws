// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISmartClawsDeviceGroup} from "../../interfaces/ISmartClawsDeviceGroup.sol";
import {IChannelFactory} from "./IChannelFactory.sol";
import {IDeviceFactory} from "./IDeviceFactory.sol";

/**
 * @title IDeviceGroupFactory
 * @notice Deploys SmartClawsDeviceGroup instances on behalf of a caller.
 * @dev A group provisions channels and devices as members are registered, so it
 *      receives the channel and device factories it should delegate that work to.
 */
interface IDeviceGroupFactory {
    function createDeviceGroup(
        address initialOwner,
        string calldata name,
        string calldata skills,
        address registry,
        IChannelFactory channelFactory,
        IChannelFactory encryptedChannelFactory,
        IDeviceFactory deviceFactory
    ) external returns (ISmartClawsDeviceGroup deviceGroup);
}
