// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {ISmartClawsDevice} from "./interfaces/ISmartClawsDevice.sol";
import {ISmartClawsChannel} from "./interfaces/ISmartClawsChannel.sol";
import {ISmartClawsDeviceGroup} from "./interfaces/ISmartClawsDeviceGroup.sol";
import {IChannelFactory} from "./factories/interfaces/IChannelFactory.sol";
import {DeviceRoles} from "./DeviceRoles.sol";

/**
 * @title SmartClawsDevice
 * @notice Represents an individual IoT device. The device owns its two channels
 *         and mediates all publishing through role-gated entry points.
 * @dev Two tiers of authority (AccessControlEnumerable):
 *        - DEFAULT_ADMIN_ROLE: the managing DeviceGroup. Super-authority; admins
 *          DEVICE_ADMIN_ROLE. Can always re-appoint the device admin to override.
 *        - DEVICE_ADMIN_ROLE: the entity that controls this device. Admins
 *          PUBLISHER_ROLE and MASTER_ROLE, scoped to this device only.
 *      Operational roles:
 *        - PUBLISHER_ROLE: publishes telemetry to the outgoing channel.
 *        - MASTER_ROLE: publishes commands to the incoming channel.
 *      Publishing is mediated: the device is the owner of both channels, so it
 *      is the only account that writes to them — access is gated entirely here.
 *      Publishing also requires the managing group to be active, so deactivating
 *      a group makes all of its devices inert in O(1) (no per-device loop).
 */
contract SmartClawsDevice is AccessControlEnumerable, ISmartClawsDevice {
    address public immutable override group;
    address public immutable override registry;
    string public override deviceId;
    uint256 public immutable override createdAt;
    ISmartClawsChannel internal immutable incomingChannel;
    ISmartClawsChannel internal immutable outgoingChannel;

    modifier whenGroupActive() {
        require(ISmartClawsDeviceGroup(group).active(), GroupInactive());
        _;
    }

    /**
     * @param group_ Managing group: super-administrator (DEFAULT_ADMIN_ROLE) and
     *        the liveness authority gating publishing.
     * @param deviceAdmin Per-device administrator. Holds DEVICE_ADMIN_ROLE.
     * @param registry_ Address of the SmartClaws registry (channel registry hook).
     * @param channelFactory Factory used to provision the device's two channels.
     * @param capacity Byte capacity for both channels.
     * @param deviceId_ Human-readable device identifier.
     */
    constructor(
        address group_,
        address deviceAdmin,
        address registry_,
        IChannelFactory channelFactory,
        uint256 capacity,
        string memory deviceId_
    ) {
        require(group_ != address(0), ZeroAddress());
        require(deviceAdmin != address(0), ZeroAddress());
        require(registry_ != address(0), ZeroAddress());

        group = group_;
        registry = registry_;
        deviceId = deviceId_;
        createdAt = block.timestamp;
        incomingChannel = channelFactory.createChannel(address(this), capacity, registry_);
        outgoingChannel = channelFactory.createChannel(address(this), capacity, registry_);

        // DEVICE_ADMIN administers the operational roles; DEFAULT_ADMIN (group)
        // administers DEVICE_ADMIN (OZ default), so the group can always re-appoint.
        _setRoleAdmin(DeviceRoles.PUBLISHER_ROLE, DeviceRoles.DEVICE_ADMIN_ROLE);
        _setRoleAdmin(DeviceRoles.MASTER_ROLE, DeviceRoles.DEVICE_ADMIN_ROLE);

        _grantRole(DEFAULT_ADMIN_ROLE, group_);
        _grantRole(DeviceRoles.DEVICE_ADMIN_ROLE, deviceAdmin);
        // PUBLISHER_ROLE / MASTER_ROLE intentionally start empty.
    }

    /**
     * @notice Publishes telemetry to the outgoing channel.
     * @param payload The message bytes.
     */
    function publishTelemetry(
        bytes calldata payload
    ) external override whenGroupActive onlyRole(DeviceRoles.PUBLISHER_ROLE) {
        outgoingChannel.publishMessage(payload);
    }

    /**
     * @notice Publishes a command to the incoming channel.
     * @param payload The message bytes.
     */
    function publishCommand(
        bytes calldata payload
    ) external override whenGroupActive onlyRole(DeviceRoles.MASTER_ROLE) {
        incomingChannel.publishMessage(payload);
    }

    /**
     * @notice Decommissions the device by permanently disabling writes on both
     *         channels. Reads remain functional. Restricted to the group.
     */
    function deactivate() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        incomingChannel.disableWrites();
        outgoingChannel.disableWrites();
    }

    /**
     * @notice Temporarily suspends writes on both channels. Reversible via {unpause}.
     * @dev Distinct from {deactivate} (permanent). Restricted to the DEVICE_ADMIN.
     */
    function pause() external override onlyRole(DeviceRoles.DEVICE_ADMIN_ROLE) {
        incomingChannel.pause();
        outgoingChannel.pause();
    }

    /// @notice Lifts a {pause}. Cannot revive a decommissioned (deactivated) device.
    function unpause() external override onlyRole(DeviceRoles.DEVICE_ADMIN_ROLE) {
        incomingChannel.unpause();
        outgoingChannel.unpause();
    }

    /// @notice Manually evicts up to `maxMessages` oldest entries from the incoming channel.
    function pruneIncoming(
        uint256 maxMessages
    ) external override onlyRole(DeviceRoles.DEVICE_ADMIN_ROLE) returns (uint256 pruned) {
        return incomingChannel.prune(maxMessages);
    }

    /// @notice Manually evicts up to `maxMessages` oldest entries from the outgoing channel.
    function pruneOutgoing(
        uint256 maxMessages
    ) external override onlyRole(DeviceRoles.DEVICE_ADMIN_ROLE) returns (uint256 pruned) {
        return outgoingChannel.prune(maxMessages);
    }

    function getIncomingMessagesChannel() external view override returns (address) {
        return address(incomingChannel);
    }

    function getOutgoingMessagesChannel() external view override returns (address) {
        return address(outgoingChannel);
    }
}
