// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISmartClawsAgent {
    event AgentDeactivated(address indexed agent);
    event AgentOutboundPublished(
        address indexed agent,
        address indexed channel,
        address indexed publisher
    );
    event AgentInboundPublished(address indexed agent, address indexed channel, address indexed sender);

    error Unauthorized();
    error AlreadyInactive();

    function registry() external view returns (address);
    function agentId() external view returns (string memory);
    function metadata() external view returns (string memory);
    function createdAt() external view returns (uint256);
    function active() external view returns (bool);

    function publishOutbound(bytes calldata payload) external;
    function publishInbound(bytes calldata payload) external;
    function deactivate() external;
    function pause() external;
    function unpause() external;
    function pruneIncoming(uint256 maxMessages) external returns (uint256 pruned);
    function pruneOutgoing(uint256 maxMessages) external returns (uint256 pruned);
    function getIncomingMessagesChannel() external view returns (address);
    function getOutgoingMessagesChannel() external view returns (address);
}
