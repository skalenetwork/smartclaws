// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SmartClawsDevice} from "../SmartClawsDevice.sol";
import {ISmartClawsDevice} from "../interfaces/ISmartClawsDevice.sol";
import {IDeviceFactory} from "./interfaces/IDeviceFactory.sol";
import {IChannelFactory} from "./interfaces/IChannelFactory.sol";

/**
 * @title DeviceFactory
 * @notice Deploys SmartClawsDevice instances.
 * @dev Keeps the device creation bytecode out of SmartClawsDeviceGroup. The
 *      channel factory is forwarded so the device can provision its own channels.
 *      The factories are intentionally separate — see ChannelFactory (EIP-170).
 */
contract DeviceFactory is IDeviceFactory {
    function createDevice(
        address group,
        address deviceAdmin,
        address registry,
        IChannelFactory channelFactory,
        uint256 capacity,
        string calldata deviceId
    ) external override returns (ISmartClawsDevice device) {
        device = new SmartClawsDevice(group, deviceAdmin, registry, channelFactory, capacity, deviceId);
    }
}
