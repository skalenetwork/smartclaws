// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

interface ISmartClawsDevice is IAccessControl {
    error ZeroAddress();
    error GroupInactive();

    function group() external view returns (address);
    function registry() external view returns (address);
    function deviceId() external view returns (string memory);
    function createdAt() external view returns (uint256);

    function publishTelemetry(bytes calldata payload) external;
    function publishCommand(bytes calldata payload) external;
    function deactivate() external;
    function pause() external;
    function unpause() external;
    function pruneIncoming(uint256 maxMessages) external returns (uint256 pruned);
    function pruneOutgoing(uint256 maxMessages) external returns (uint256 pruned);

    function getIncomingMessagesChannel() external view returns (address);
    function getOutgoingMessagesChannel() external view returns (address);
}
