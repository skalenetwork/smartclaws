// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pagination} from "./Pagination.sol";
import {ISmartClaws} from "./interfaces/ISmartClaws.sol";
import {ISmartClawsChannel} from "./interfaces/ISmartClawsChannel.sol";
import {ISmartClawsDeviceGroup} from "./interfaces/ISmartClawsDeviceGroup.sol";
import {ISmartClawsAgent} from "./interfaces/ISmartClawsAgent.sol";
import {IPublicKeyRegistry} from "./interfaces/IPublicKeyRegistry.sol";
import {IChannelFactory} from "./factories/interfaces/IChannelFactory.sol";
import {IDeviceFactory} from "./factories/interfaces/IDeviceFactory.sol";
import {IDeviceGroupFactory} from "./factories/interfaces/IDeviceGroupFactory.sol";
import {IAgentFactory} from "./factories/interfaces/IAgentFactory.sol";
import {IPublicKeyRegistryFactory} from "./factories/interfaces/IPublicKeyRegistryFactory.sol";
import {InvalidFactoryAddress, InvalidRegistryAddress} from "./Errors.sol";

/**
 * @title SmartClaws
 * @notice Global registry and entry point for the SmartClaws protocol.
 * @dev Tracks channels, device groups, and agents. All deployment is delegated
 *      to immutable factories, which keeps the creation bytecode of those
 *      contracts out of this registry and well under the EIP-170 size limit.
 *      Uses EnumerableSet for O(1) add/remove/contains on all registries.
 */
contract SmartClaws is ISmartClaws {
    using EnumerableSet for EnumerableSet.AddressSet;
    using Pagination for EnumerableSet.AddressSet;

    IChannelFactory public immutable channelFactory;
    IChannelFactory public immutable encryptedChannelFactory;
    IDeviceFactory public immutable deviceFactory;
    IDeviceGroupFactory public immutable deviceGroupFactory;
    IAgentFactory public immutable agentFactory;
    // TODO: remove registry factory — the registry is now deployed and passed in directly.
    IPublicKeyRegistryFactory public immutable override publicKeyRegistryFactory;
    IPublicKeyRegistry public immutable override publicKeyRegistry;

    EnumerableSet.AddressSet private _channels;
    EnumerableSet.AddressSet private _deviceGroups;
    EnumerableSet.AddressSet private _agents;

    constructor(
        IChannelFactory channelFactory_,
        IChannelFactory encryptedChannelFactory_,
        IDeviceFactory deviceFactory_,
        IDeviceGroupFactory deviceGroupFactory_,
        IAgentFactory agentFactory_,
        IPublicKeyRegistryFactory publicKeyRegistryFactory_,
        IPublicKeyRegistry publicKeyRegistry_
    ) {
        require(address(channelFactory_) != address(0), InvalidFactoryAddress(address(0)));
        require(address(encryptedChannelFactory_) != address(0), InvalidFactoryAddress(address(0)));
        require(address(deviceFactory_) != address(0), InvalidFactoryAddress(address(0)));
        require(address(deviceGroupFactory_) != address(0), InvalidFactoryAddress(address(0)));
        require(address(agentFactory_) != address(0), InvalidFactoryAddress(address(0)));
        require(address(publicKeyRegistryFactory_) != address(0), InvalidFactoryAddress(address(0)));
        require(address(publicKeyRegistry_) != address(0), InvalidRegistryAddress(address(0)));

        channelFactory = channelFactory_;
        encryptedChannelFactory = encryptedChannelFactory_;
        deviceFactory = deviceFactory_;
        deviceGroupFactory = deviceGroupFactory_;
        agentFactory = agentFactory_;
        publicKeyRegistryFactory = publicKeyRegistryFactory_;
        publicKeyRegistry = publicKeyRegistry_;
    }

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
    ) external override returns (address channel) {
        return _createChannel(channelFactory, ownerAddress, maxCapacityBytes);
    }

    /**
     * @notice Deploys a new BITE-encrypted channel (SmartClawsChannelEncrypted) and registers it.
     * @param ownerAddress Initial wallet address granted administrative control.
     * @param maxCapacityBytes Total byte limit for the channel before pruning begins.
     * @return channel Address of the newly deployed encrypted channel contract.
     */
    function createEncryptedChannel(
        address ownerAddress,
        uint256 maxCapacityBytes
    ) external override returns (address channel) {
        return _createChannel(encryptedChannelFactory, ownerAddress, maxCapacityBytes);
    }

    /**
     * @notice Disables writes on a channel and removes it from the registry.
     * @dev The channel contract remains deployed and all read methods continue to function.
     * @param channelAddress Address of the channel to delete.
     */
    function deleteChannel(address channelAddress) external override {
        require(_channels.contains(channelAddress), ChannelNotRegistered(channelAddress));
        require(msg.sender == Ownable(channelAddress).owner(), NotChannelOwner(channelAddress, msg.sender));

        ISmartClawsChannel(channelAddress).disableWrites();
        assert(_channels.remove(channelAddress));
        emit ChannelDeleted(channelAddress);
    }

    // --- Device Group Management ---

    /**
     * @notice Registers a new device group.
     * @dev The group receives both the plain and encrypted channel factories, so
     *      it can register individually plain or BITE-encrypted devices via
     *      SmartClawsDeviceGroup.registerDevice / registerEncryptedDevice.
     * @param deviceGroupName Human-readable name for the group.
     * @param skills_ Capability description (e.g., SKILLS.md content or hash).
     * @return deviceGroup Address of the newly deployed DeviceGroup contract.
     */
    function registerDeviceGroup(
        string calldata deviceGroupName,
        string calldata skills_
    ) external override returns (address deviceGroup) {
        deviceGroup = address(
            deviceGroupFactory.createDeviceGroup(
                msg.sender,
                deviceGroupName,
                skills_,
                address(this),
                channelFactory,
                encryptedChannelFactory,
                deviceFactory
            )
        );
        assert(_deviceGroups.add(deviceGroup));
        emit DeviceGroupRegistered(deviceGroup, deviceGroupName);
    }

    /**
     * @notice Deactivates a device group and removes it from the registry.
     * @dev Existing devices and channels remain functional and readable.
     * @param deviceGroup Address of the device group to unregister.
     */
    function unregisterDeviceGroup(address deviceGroup) external override {
        require(_deviceGroups.contains(deviceGroup), DeviceGroupNotRegistered(deviceGroup));

        require(msg.sender == Ownable(deviceGroup).owner(), NotGroupOwner(deviceGroup, msg.sender));

        // Deactivation propagates to devices implicitly: SmartClawsDevice gates all
        // publishing on group.active() (see whenGroupActive), so a deactivated group
        // makes every one of its devices inert in O(1) — no per-device loop, and the
        // device contracts/channels remain deployed and readable.
        ISmartClawsDeviceGroup(deviceGroup).deactivate();
        assert(_deviceGroups.remove(deviceGroup));
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
    ) external override returns (address agent) {
        return _registerAgent(channelFactory, agentId, metadata, channelCapacity);
    }

    /**
     * @notice Registers a new OpenClaw AI Agent whose channels are BITE-encrypted.
     * @param agentId Human-readable agent identifier.
     * @param metadata Agent capability description or configuration.
     * @param channelCapacity Byte capacity for the agent's channels.
     * @return agent Address of the newly deployed Agent contract.
     */
    function registerEncryptedAgent(
        string calldata agentId,
        string calldata metadata,
        uint256 channelCapacity
    ) external override returns (address agent) {
        return _registerAgent(encryptedChannelFactory, agentId, metadata, channelCapacity);
    }

    /**
     * @notice Deactivates an agent and disables its outgoing channel.
     * @dev The agent contract and channels remain deployed. Reads still work.
     * @param agent Address of the agent to unregister.
     */
    function unregisterAgent(address agent) external override {
        require(_agents.contains(agent), AgentNotRegistered(agent));

        ISmartClawsAgent agentContract = ISmartClawsAgent(agent);
        require(msg.sender == Ownable(agent).owner(), NotAgentOwner(agent, msg.sender));

        // Disable writes on both channels. The registry is registered as each
        // channel's `registry`, so it is authorized to call disableWrites.
        ISmartClawsChannel(agentContract.getOutgoingMessagesChannel()).disableWrites();
        ISmartClawsChannel(agentContract.getIncomingMessagesChannel()).disableWrites();
        agentContract.deactivate();

        assert(_agents.remove(agent));
        emit AgentUnregistered(agent);
    }

    // --- View Functions ---
    //
    // NOTE: registration is currently permissionless, so these registries can grow
    // without bound. The no-argument getters below return the full set in one call
    // and may run out of gas (or exceed node response limits) once a registry is
    // large; prefer the paginated (offset, limit) overloads off-chain. If spam ever
    // becomes a problem, gate the create/register entry points instead of these.

    function getChannels() external view override returns (address[] memory) {
        return _channels.values();
    }

    function getChannels(
        uint256 offset,
        uint256 limit
    ) external view override returns (address[] memory) {
        return _channels.slice(offset, limit);
    }

    function getChannelCount() external view override returns (uint256) {
        return _channels.length();
    }

    function isRegisteredChannel(address channel) external view override returns (bool) {
        return _channels.contains(channel);
    }

    function getDeviceGroups() external view override returns (address[] memory) {
        return _deviceGroups.values();
    }

    function getDeviceGroups(
        uint256 offset,
        uint256 limit
    ) external view override returns (address[] memory) {
        return _deviceGroups.slice(offset, limit);
    }

    function getDeviceGroupCount() external view override returns (uint256) {
        return _deviceGroups.length();
    }

    function isRegisteredDeviceGroup(address group) external view override returns (bool) {
        return _deviceGroups.contains(group);
    }

    function getAgents() external view override returns (address[] memory) {
        return _agents.values();
    }

    function getAgents(
        uint256 offset,
        uint256 limit
    ) external view override returns (address[] memory) {
        return _agents.slice(offset, limit);
    }

    function getAgentCount() external view override returns (uint256) {
        return _agents.length();
    }

    function isRegisteredAgent(address agent) external view override returns (bool) {
        return _agents.contains(agent);
    }

    // --- Internal helpers ---
    // Plain and encrypted entry points share these; only the factory differs.
    // The factory is also what the emitted `encrypted` flag is derived from, so
    // the event can never disagree with the channels that were actually built.

    function _isEncrypted(IChannelFactory factory) private view returns (bool) {
        return address(factory) == address(encryptedChannelFactory);
    }

    function _createChannel(
        IChannelFactory factory,
        address ownerAddress,
        uint256 maxCapacityBytes
    ) private returns (address channel) {
        channel = address(factory.createChannel(ownerAddress, maxCapacityBytes, address(this)));
        assert(_channels.add(channel));
        emit ChannelCreated(channel, ownerAddress, _isEncrypted(factory));
    }

    function _registerAgent(
        IChannelFactory factory,
        string calldata agentId,
        string calldata metadata,
        uint256 channelCapacity
    ) private returns (address agent) {
        agent = address(
            agentFactory.createAgent({
                initialOwner: msg.sender,
                channelCapacity: channelCapacity,
                registry: address(this),
                channelFactory: factory,
                agentId: agentId,
                metadata: metadata
            })
        );
        assert(_agents.add(agent));
        emit AgentRegistered(agent, agentId, metadata, _isEncrypted(factory));
    }
}
