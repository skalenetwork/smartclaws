// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ISmartClawsAgent} from "./interfaces/ISmartClawsAgent.sol";
import {ISmartClawsChannel} from "./interfaces/ISmartClawsChannel.sol";
import {ISmartClawsChannelEncrypted} from "./interfaces/ISmartClawsChannelEncrypted.sol";
import {IChannelFactory} from "./factories/interfaces/IChannelFactory.sol";
import {InvalidRegistryAddress} from "./Errors.sol";

/**
 * @title SmartClawsAgent
 * @notice Represents an individual OpenClaw AI Agent with fixed channels.
 * @dev The agent contract owns both of its channels, so all writes are mediated
 *      through role-gated agent methods. Transferring agent ownership moves the
 *      standing DEFAULT_ADMIN_ROLE / AGENT_ADMIN_ROLE / PUBLISHER_ROLE grants to
 *      the new owner so ownership and role administration stay aligned. The
 *      registry can deactivate the agent, which disables its channels.
 *      `agentId` / `metadata` are mutable-by-nobody descriptors set at creation;
 *      agents are expected to be re-registered rather than edited in place.
 */
contract SmartClawsAgent is Ownable2Step, AccessControlEnumerable, ISmartClawsAgent {
    /// @notice Agent administrator; manages PUBLISHER_ROLE and SENDER_ROLE.
    bytes32 public constant AGENT_ADMIN_ROLE = keccak256("AGENT_ADMIN_ROLE");
    /// @notice May publish messages to the agent's outgoing channel.
    bytes32 public constant PUBLISHER_ROLE = keccak256("PUBLISHER_ROLE");
    /// @notice May publish messages to the agent's incoming channel.
    bytes32 public constant SENDER_ROLE = keccak256("SENDER_ROLE");

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

    modifier onlyRegistryOwnerOrAgentAdmin() {
        require(
            msg.sender == registry || msg.sender == owner() || hasRole(AGENT_ADMIN_ROLE, msg.sender),
            Unauthorized()
        );
        _;
    }

    modifier whenActive() {
        require(active, AlreadyInactive());
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

        _setRoleAdmin(AGENT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(PUBLISHER_ROLE, AGENT_ADMIN_ROLE);
        _setRoleAdmin(SENDER_ROLE, AGENT_ADMIN_ROLE);

        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(AGENT_ADMIN_ROLE, initialOwner);
        _grantRole(PUBLISHER_ROLE, initialOwner);
    }

    /**
     * @notice Publishes an agent-authored message to the outgoing channel.
     * @param payload The message bytes.
     */
    function publishOutbound(
        bytes calldata payload
    ) external payable override whenActive onlyRole(PUBLISHER_ROLE) {
        if (_publishMessage(outgoingChannel, payload)) {
            emit AgentOutboundPublished(address(this), address(outgoingChannel), msg.sender);
        } else {
            emit AgentOutboundScheduled(address(this), address(outgoingChannel), msg.sender);
        }
    }

    /**
     * @notice Publishes a message addressed to the agent's incoming channel.
     * @param payload The message bytes.
     */
    function publishInbound(
        bytes calldata payload
    ) external payable override whenActive onlyRole(SENDER_ROLE) {
        if (_publishMessage(incomingChannel, payload)) {
            emit AgentInboundPublished(address(this), address(incomingChannel), msg.sender);
        } else {
            emit AgentInboundScheduled(address(this), address(incomingChannel), msg.sender);
        }
    }

    function addIncomingReader(address reader) external override onlyRegistryOwnerOrAgentAdmin {
        _encryptedChannel(incomingChannel).addReader(reader);
    }

    function removeIncomingReader(address reader) external override onlyRegistryOwnerOrAgentAdmin {
        _encryptedChannel(incomingChannel).removeReader(reader);
    }

    function addOutgoingReader(address reader) external override onlyRegistryOwnerOrAgentAdmin {
        _encryptedChannel(outgoingChannel).addReader(reader);
    }

    function removeOutgoingReader(address reader) external override onlyRegistryOwnerOrAgentAdmin {
        _encryptedChannel(outgoingChannel).removeReader(reader);
    }

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
     * @dev Distinct from {deactivate}, which is permanent. Callable by the
     *      owner, registry, or AGENT_ADMIN_ROLE. Pausing leaves `active`
     *      untouched; both gates must be clear for the agent to publish.
     */
    function pause() external override onlyRegistryOwnerOrAgentAdmin {
        incomingChannel.pause();
        outgoingChannel.pause();
    }

    /// @notice Lifts a {pause}. Does not revive a deactivated agent.
    function unpause() external override onlyRegistryOwnerOrAgentAdmin {
        incomingChannel.unpause();
        outgoingChannel.unpause();
    }

    /// @notice Manually evicts up to `maxMessages` oldest entries from the incoming channel.
    function pruneIncoming(
        uint256 maxMessages
    ) external override onlyRegistryOwnerOrAgentAdmin returns (uint256 pruned) {
        return incomingChannel.prune(maxMessages);
    }

    /// @notice Manually evicts up to `maxMessages` oldest entries from the outgoing channel.
    function pruneOutgoing(
        uint256 maxMessages
    ) external override onlyRegistryOwnerOrAgentAdmin returns (uint256 pruned) {
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

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(AccessControlEnumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _publishMessage(ISmartClawsChannel channel, bytes calldata payload) private returns (bool publishedNow) {
        if (channel.isEncrypted()) {
            ISmartClawsChannelEncrypted(address(channel)).publishMessageFor{value: msg.value}(
                payload,
                msg.sender
            );
            return false;
        } else {
            require(
                msg.value == 0,
                ISmartClawsChannel.NativeValueNotAccepted(msg.value)
            );
            channel.publishMessage(payload);
            return true;
        }
    }

    function _encryptedChannel(
        ISmartClawsChannel channel
    ) private pure returns (ISmartClawsChannelEncrypted encryptedChannel) {
        require(channel.isEncrypted(), ISmartClawsChannel.EncryptedOperationUnsupported());
        return ISmartClawsChannelEncrypted(address(channel));
    }

    function _transferOwnership(address newOwner) internal override {
        address previousOwner = owner();
        super._transferOwnership(newOwner);

        if (previousOwner != address(0)) {
            _revokeRole(DEFAULT_ADMIN_ROLE, previousOwner);
            _revokeRole(AGENT_ADMIN_ROLE, previousOwner);
            _revokeRole(PUBLISHER_ROLE, previousOwner);
        }

        if (newOwner != address(0)) {
            _grantRole(DEFAULT_ADMIN_ROLE, newOwner);
            _grantRole(AGENT_ADMIN_ROLE, newOwner);
            _grantRole(PUBLISHER_ROLE, newOwner);
        }
    }
}
