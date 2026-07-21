// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISmartClawsAgent} from "../../interfaces/ISmartClawsAgent.sol";
import {IChannelFactory} from "./IChannelFactory.sol";

/**
 * @title IAgentFactory
 * @notice Deploys SmartClawsAgent instances on behalf of a caller.
 * @dev The agent provisions its own channels, so it receives the channel
 *      factory it should delegate that work to.
 */
interface IAgentFactory {
    function createAgent(
        address initialOwner,
        uint256 channelCapacity,
        address registry,
        IChannelFactory channelFactory,
        string calldata agentId,
        string calldata metadata
    ) external returns (ISmartClawsAgent agent);
}
