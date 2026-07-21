// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISmartClaws {
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

    function createChannel(address ownerAddress, uint256 maxCapacityBytes) external returns (address channel);
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
