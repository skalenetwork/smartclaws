// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SmartClawsDeviceGroup} from "../SmartClawsDeviceGroup.sol";
import {ISmartClawsDeviceGroup} from "../interfaces/ISmartClawsDeviceGroup.sol";
import {IDeviceGroupFactory} from "./interfaces/IDeviceGroupFactory.sol";
import {IChannelFactory} from "./interfaces/IChannelFactory.sol";
import {IDeviceFactory} from "./interfaces/IDeviceFactory.sol";

/**
 * @title DeviceGroupFactory
 * @notice Deploys SmartClawsDeviceGroup instances.
 * @dev Keeps the device-group creation bytecode out of SmartClaws. The channel
 *      and device factories are forwarded so the group can provision channels
 *      and devices as members are registered.
 *      The factories are intentionally separate — see ChannelFactory (EIP-170).
 */
contract DeviceGroupFactory is IDeviceGroupFactory {
    function createDeviceGroup(
        address initialOwner,
        string calldata name,
        string calldata skills,
        address registry,
        IChannelFactory channelFactory,
        IDeviceFactory deviceFactory
    ) external override returns (ISmartClawsDeviceGroup deviceGroup) {
        deviceGroup = new SmartClawsDeviceGroup(
            initialOwner,
            name,
            skills,
            registry,
            channelFactory,
            deviceFactory
        );
    }
}
