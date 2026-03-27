// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {SmartClawsChannel} from "./SmartClawsChannel.sol";

/**
 * @title SmartClawsAgent
 * @notice Represents an individual OpenClaw AI Agent with fixed channels.
 * @dev Ownership transfer cascades to both channels so permissions stay aligned.
 *      The registry can deactivate the agent, which disables its outgoing channel.
 */
contract SmartClawsAgent is Ownable2Step {
    address public immutable registry;
    address public immutable incomingChannel;
    address public immutable outgoingChannel;
    bool public active = true;

    event AgentDeactivated(address indexed agent);

    error Unauthorized();
    error AlreadyInactive();

    modifier onlyRegistry() {
        if (msg.sender != registry) revert Unauthorized();
        _;
    }

    constructor(
        address initialOwner,
        address incomingChannel_,
        address outgoingChannel_,
        address registry_
    ) Ownable(initialOwner) {
        if (incomingChannel_ == address(0) || outgoingChannel_ == address(0) || registry_ == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }

        incomingChannel = incomingChannel_;
        outgoingChannel = outgoingChannel_;
        registry = registry_;
    }

    /**
     * @notice Transfers ownership of the agent and both channels to the new owner.
     * @dev Overrides Ownable2Step._transferOwnership to cascade channel ownership.
     */
    function _transferOwnership(address newOwner) internal override {
        super._transferOwnership(newOwner);
        SmartClawsChannel(incomingChannel).transferOwnership(newOwner);
        SmartClawsChannel(outgoingChannel).transferOwnership(newOwner);
    }

    /**
     * @notice Deactivates the agent. Called by the registry during unregistration.
     */
    function deactivate() external onlyRegistry {
        if (!active) revert AlreadyInactive();
        active = false;
        emit AgentDeactivated(address(this));
    }

    function getIncomingMessagesChannel() external view returns (address) {
        return incomingChannel;
    }

    function getOutgoingMessagesChannel() external view returns (address) {
        return outgoingChannel;
    }
}
