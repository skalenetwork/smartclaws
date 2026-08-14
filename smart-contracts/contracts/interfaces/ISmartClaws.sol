// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPublicKeyRegistry} from "./IPublicKeyRegistry.sol";
import {IPublicKeyRegistryFactory} from "../factories/interfaces/IPublicKeyRegistryFactory.sol";

interface ISmartClaws {
    /// @param encrypted True when the channel is a BITE-encrypted SmartClawsChannelEncrypted.
    ///        Indexed so indexers can filter plain vs encrypted without a follow-up call.
    event ChannelCreated(address indexed channel, address indexed owner, bool indexed encrypted);
    event ChannelDeleted(address indexed channel);
    event DeviceGroupRegistered(address indexed deviceGroup, string deviceGroupName);
    event DeviceGroupUnregistered(address indexed deviceGroup);
    /// @param encrypted True when both of the agent's channels are BITE-encrypted.
    event AgentRegistered(
        address indexed agent,
        string agentId,
        string metadata,
        bool indexed encrypted
    );
    event AgentUnregistered(address indexed agent);

    error NotChannelOwner(address channel, address caller);
    error ChannelNotRegistered(address channel);
    error DeviceGroupNotRegistered(address deviceGroup);
    error NotGroupOwner(address group, address caller);
    error AgentNotRegistered(address agent);
    error NotAgentOwner(address agent, address caller);

    function publicKeyRegistry() external view returns (IPublicKeyRegistry);
    function publicKeyRegistryFactory() external view returns (IPublicKeyRegistryFactory);

    function createChannel(address ownerAddress, uint256 maxCapacityBytes) external returns (address channel);
    function createEncryptedChannel(
        address ownerAddress,
        uint256 maxCapacityBytes
    ) external returns (address channel);
    function deleteChannel(address channelAddress) external;
    function registerDeviceGroup(
        string calldata deviceGroupName,
        string calldata skills_
    ) external returns (address deviceGroup);
    function unregisterDeviceGroup(address deviceGroup) external;
    function registerAgent(
        string calldata agentId,
        string calldata metadata,
        uint256 channelCapacity
    ) external returns (address agent);
    function registerEncryptedAgent(
        string calldata agentId,
        string calldata metadata,
        uint256 channelCapacity
    ) external returns (address agent);
    function unregisterAgent(address agent) external;

    function getChannels() external view returns (address[] memory);
    function getChannels(uint256 offset, uint256 limit) external view returns (address[] memory);
    function getChannelCount() external view returns (uint256);
    function isRegisteredChannel(address channel) external view returns (bool);
    function getDeviceGroups() external view returns (address[] memory);
    function getDeviceGroups(uint256 offset, uint256 limit) external view returns (address[] memory);
    function getDeviceGroupCount() external view returns (uint256);
    function isRegisteredDeviceGroup(address group) external view returns (bool);
    function getAgents() external view returns (address[] memory);
    function getAgents(uint256 offset, uint256 limit) external view returns (address[] memory);
    function getAgentCount() external view returns (uint256);
    function isRegisteredAgent(address agent) external view returns (bool);
}
