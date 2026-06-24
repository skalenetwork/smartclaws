// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SmartClawsAgent} from "../SmartClawsAgent.sol";
import {ISmartClawsAgent} from "../interfaces/ISmartClawsAgent.sol";
import {IAgentFactory} from "./interfaces/IAgentFactory.sol";
import {IChannelFactory} from "./interfaces/IChannelFactory.sol";

/**
 * @title AgentFactory
 * @notice Deploys SmartClawsAgent instances.
 * @dev Keeps the agent creation bytecode out of SmartClaws. The channel factory
 *      is forwarded so the agent can provision its own incoming/outgoing channels.
 *      The factories are intentionally separate — see ChannelFactory (EIP-170).
 */
contract AgentFactory is IAgentFactory {
    function createAgent(
        address initialOwner,
        uint256 channelCapacity,
        address registry,
        IChannelFactory channelFactory,
        string calldata agentId,
        string calldata metadata
    ) external override returns (ISmartClawsAgent agent) {
        agent = new SmartClawsAgent(
            initialOwner,
            channelCapacity,
            registry,
            channelFactory,
            agentId,
            metadata
        );
    }
}
