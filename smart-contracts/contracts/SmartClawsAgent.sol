// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ISmartClawsAgent} from "./interfaces/ISmartClawsAgent.sol";
import {ISmartClawsChannel} from "./interfaces/ISmartClawsChannel.sol";
import {IChannelFactory} from "./factories/interfaces/IChannelFactory.sol";
import {InvalidRegistryAddress} from "./Errors.sol";

/**
 * @title SmartClawsAgent
 * @notice Represents an individual OpenClaw AI Agent with fixed channels.
 * @dev The agent contract owns both of its channels, so transferring agent
 *      ownership keeps channel control aligned without any extra bookkeeping
 *      (the channels are owned by `address(this)`, never by the agent's owner).
 *      The registry can deactivate the agent, which disables its channels.
 *      `agentId` / `metadata` are mutable-by-nobody descriptors set at creation;
 *      agents are expected to be re-registered rather than edited in place.
 */
contract SmartClawsAgent is Ownable2Step, ISmartClawsAgent {
    address public immutable override registry;
    ISmartClawsChannel internal immutable incomingChannel;
    ISmartClawsChannel internal immutable outgoingChannel;
    string public override agentId;
    string public override metadata;
    uint256 public immutable override createdAt;
    bool public override active = true;

    modifier onlyRegistryOrOwner() {
        require(msg.sender == registry || msg.sender == owner(), Unauthorized());
        _;
    }

    constructor(
        address initialOwner,
        uint256 channelCapacity,
        address registry_,
        IChannelFactory channelFactory,
        string memory agentId_,
        string memory metadata_
    ) Ownable(initialOwner) {
        require(initialOwner != address(0), OwnableInvalidOwner(address(0)));
        require(registry_ != address(0), InvalidRegistryAddress(address(0)));

        incomingChannel = channelFactory.createChannel(address(this), channelCapacity, registry_);
        outgoingChannel = channelFactory.createChannel(address(this), channelCapacity, registry_);
        registry = registry_;
        agentId = agentId_;
        metadata = metadata_;
        createdAt = block.timestamp;
    }

    function publishMessage(bytes calldata payload) external onlyOwner {
        require(active, AlreadyInactive());
        outgoingChannel.publishMessage(payload);
    }

    // TODO
    // Need to add "notify" function. It should allow other parties to publish to the incoming channel.
    // After that, we may update this contract to AccessControl
    // END of TODO

    /**
     * @notice Deactivates the agent. Called by the registry during unregistration.
     */
    function deactivate() external override onlyRegistryOrOwner {
        if (!active) return;
        active = false;
        emit AgentDeactivated(address(this));
    }

    /**
     * @notice Temporarily suspends writes on both channels. Reversible via {unpause}.
     * @dev Distinct from {deactivate}, which is permanent. Pausing leaves `active`
     *      untouched; both gates must be clear for the agent to publish.
     */
    function pause() external override onlyRegistryOrOwner {
        incomingChannel.pause();
        outgoingChannel.pause();
    }

    /// @notice Lifts a {pause}. Does not revive a deactivated agent.
    function unpause() external override onlyRegistryOrOwner {
        incomingChannel.unpause();
        outgoingChannel.unpause();
    }

    /// @notice Manually evicts up to `maxMessages` oldest entries from the incoming channel.
    function pruneIncoming(
        uint256 maxMessages
    ) external override onlyRegistryOrOwner returns (uint256 pruned) {
        return incomingChannel.prune(maxMessages);
    }

    /// @notice Manually evicts up to `maxMessages` oldest entries from the outgoing channel.
    function pruneOutgoing(
        uint256 maxMessages
    ) external override onlyRegistryOrOwner returns (uint256 pruned) {
        return outgoingChannel.prune(maxMessages);
    }

    // The channel addresses are exposed so callers (the SDK) can read messages
    // directly off the SmartClawsChannel contract; the agent does not re-wrap reads.
    function getIncomingMessagesChannel() external view override returns (address) {
        return address(incomingChannel);
    }

    function getOutgoingMessagesChannel() external view override returns (address) {
        return address(outgoingChannel);
    }
}
