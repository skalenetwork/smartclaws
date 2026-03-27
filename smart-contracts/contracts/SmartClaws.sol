// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {SmartClawsChannel} from "./SmartClawsChannel.sol";
import {SmartClawsDeviceGroup} from "./SmartClawsDeviceGroup.sol";
import {SmartClawsAgent} from "./SmartClawsAgent.sol";

/**
 * @title SmartClaws
 * @notice Global registry and entry point for the SmartClaws protocol.
 * @dev Deploys and tracks channels, device groups, and agents.
 *      Uses EnumerableSet for O(1) add/remove/contains on all registries.
 */
contract SmartClaws {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private _channels;
    EnumerableSet.AddressSet private _deviceGroups;
    EnumerableSet.AddressSet private _agents;

    event ChannelCreated(address indexed channel, address indexed owner);
    event ChannelDeleted(address indexed channel);
    event DeviceGroupRegistered(address indexed deviceGroup, string deviceGroupName);
    event DeviceGroupUnregistered(address indexed deviceGroup);
    event AgentRegistered(address indexed agent, string agentId, string metadata);
    event AgentUnregistered(address indexed agent);

    error NotChannelOwner(address channel, address caller);
    error ChannelNotRegistered(address channel);
    error DeviceGroupNotRegistered(address deviceGroup);
    error NotGroupOwner(address group, address caller);
    error AgentNotRegistered(address agent);
    error NotAgentOwner(address agent, address caller);

    // --- Channel Management ---

    /**
     * @notice Deploys a new SmartClawsChannel and registers it.
     * @param ownerAddress Initial wallet address granted administrative control.
     * @param maxCapacityBytes Total byte limit for the channel before pruning begins.
     * @return channel Address of the newly deployed channel contract.
     */
    function createChannel(
        address ownerAddress,
        uint256 maxCapacityBytes
    ) external returns (address channel) {
        SmartClawsChannel newChannel = new SmartClawsChannel(
            ownerAddress,
            maxCapacityBytes,
            address(this)
        );
        channel = address(newChannel);
        _channels.add(channel);
        emit ChannelCreated(channel, ownerAddress);
    }

    /**
     * @notice Disables writes on a channel and removes it from the registry.
     * @dev The channel contract remains deployed and all read methods continue to function.
     * @param channelAddress Address of the channel to delete.
     */
    function deleteChannel(address channelAddress) external {
        if (!_channels.contains(channelAddress)) {
            revert ChannelNotRegistered(channelAddress);
        }

        SmartClawsChannel channel = SmartClawsChannel(channelAddress);
        if (msg.sender != channel.owner()) {
            revert NotChannelOwner(channelAddress, msg.sender);
        }

        channel.disableWrites();
        _channels.remove(channelAddress);
        emit ChannelDeleted(channelAddress);
    }

    // --- Device Group Management ---

    /**
     * @notice Registers a new device group.
     * @param deviceGroupName Human-readable name for the group.
     * @param skills_ Capability description (e.g., SKILLS.md content or hash).
     * @return deviceGroup Address of the newly deployed DeviceGroup contract.
     */
    function registerDeviceGroup(
        string calldata deviceGroupName,
        string calldata skills_
    ) external returns (address deviceGroup) {
        SmartClawsDeviceGroup newGroup = new SmartClawsDeviceGroup(
            msg.sender,
            deviceGroupName,
            skills_,
            address(this)
        );
        deviceGroup = address(newGroup);
        _deviceGroups.add(deviceGroup);
        emit DeviceGroupRegistered(deviceGroup, deviceGroupName);
    }

    /**
     * @notice Deactivates a device group and removes it from the registry.
     * @dev Existing devices and channels remain functional and readable.
     * @param deviceGroup Address of the device group to unregister.
     */
    function unregisterDeviceGroup(address deviceGroup) external {
        if (!_deviceGroups.contains(deviceGroup)) {
            revert DeviceGroupNotRegistered(deviceGroup);
        }

        SmartClawsDeviceGroup group = SmartClawsDeviceGroup(deviceGroup);
        if (msg.sender != group.owner()) {
            revert NotGroupOwner(deviceGroup, msg.sender);
        }

        group.deactivate();
        _deviceGroups.remove(deviceGroup);
        emit DeviceGroupUnregistered(deviceGroup);
    }

    // --- Agent Management ---

    /**
     * @notice Registers a new OpenClaw AI Agent with dedicated channels.
     * @param agentId Human-readable agent identifier.
     * @param metadata Agent capability description or configuration.
     * @param channelCapacity Byte capacity for the agent's channels.
     * @return agent Address of the newly deployed Agent contract.
     */
    function registerAgent(
        string calldata agentId,
        string calldata metadata,
        uint256 channelCapacity
    ) external returns (address agent) {
        SmartClawsChannel incoming = new SmartClawsChannel(
            msg.sender,
            channelCapacity,
            address(this)
        );
        SmartClawsChannel outgoing = new SmartClawsChannel(
            msg.sender,
            channelCapacity,
            address(this)
        );

        SmartClawsAgent newAgent = new SmartClawsAgent(
            msg.sender,
            address(incoming),
            address(outgoing),
            address(this)
        );
        agent = address(newAgent);

        _agents.add(agent);
        emit AgentRegistered(agent, agentId, metadata);
    }

    /**
     * @notice Deactivates an agent and disables its outgoing channel.
     * @dev The agent contract and channels remain deployed. Reads still work.
     * @param agent Address of the agent to unregister.
     */
    function unregisterAgent(address agent) external {
        if (!_agents.contains(agent)) revert AgentNotRegistered(agent);

        SmartClawsAgent agentContract = SmartClawsAgent(agent);
        if (msg.sender != agentContract.owner()) {
            revert NotAgentOwner(agent, msg.sender);
        }

        SmartClawsChannel(agentContract.getOutgoingMessagesChannel()).disableWrites();
        agentContract.deactivate();

        _agents.remove(agent);
        emit AgentUnregistered(agent);
    }

    // --- View Functions ---

    function getChannels() external view returns (address[] memory) {
        return _channels.values();
    }

    function getChannelCount() external view returns (uint256) {
        return _channels.length();
    }

    function isRegisteredChannel(address channel) external view returns (bool) {
        return _channels.contains(channel);
    }

    function getDeviceGroups() external view returns (address[] memory) {
        return _deviceGroups.values();
    }

    function getDeviceGroupCount() external view returns (uint256) {
        return _deviceGroups.length();
    }

    function isRegisteredDeviceGroup(address group) external view returns (bool) {
        return _deviceGroups.contains(group);
    }

    function getAgents() external view returns (address[] memory) {
        return _agents.values();
    }

    function getAgentCount() external view returns (uint256) {
        return _agents.length();
    }

    function isRegisteredAgent(address agent) external view returns (bool) {
        return _agents.contains(agent);
    }
}
