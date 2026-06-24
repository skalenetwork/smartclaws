// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISmartClawsChannel {
    event MessagePublished(address indexed channel, uint256 indexed offset);
    event MessagesPruned(
        address indexed channel,
        uint256 indexed newStartOffset,
        uint256 indexed prunedCount
    );
    event WritesDisabled(address indexed channel);
    event PublisherAdded(address indexed publisher);
    event PublisherRemoved(address indexed publisher);

    error WritesAreDisabled();
    error Unauthorized();
    error PayloadExceedsCapacity(uint256 payloadSize, uint256 maxCapacity);
    error EmptyPayload();
    error ChannelEmpty();
    error MessagePruned(uint256 requestedOffset, uint256 oldestAvailable);
    error InvalidOffset(uint256 requestedOffset, uint256 nextOffset);
    error PublisherAlreadyAuthorized(address publisher);
    error PublisherNotAuthorized(address publisher);
    error CannotModifyOwnerAsPublisher();
    error BatchTooLarge(uint256 requested, uint256 available);
    error ZeroCapacity();

    function registry() external view returns (address);
    function maxCapacityBytes() external view returns (uint256);
    function totalBytes() external view returns (uint256);
    function startOffset() external view returns (uint256);
    function nextOffset() external view returns (uint256);
    function writesEnabled() external view returns (bool);

    function disableWrites() external;
    function pause() external;
    function unpause() external;
    function prune(uint256 maxMessages) external returns (uint256 pruned);
    function publishMessage(bytes calldata payload) external;
    function addPublisher(address publisher) external;
    function removePublisher(address publisher) external;

    function readMessage(uint256 offset) external view returns (bytes memory payload);
    function readMessages(
        uint256 fromOffset,
        uint256 count
    ) external view returns (bytes[] memory payloads, uint256[] memory offsets);
    function getLatestMessageOffset() external view returns (uint256);
    function getOldestMessageOffset() external view returns (uint256);
    function getMessageCount() external view returns (uint256);
    function isAuthorizedPublisher(address account) external view returns (bool);
    function getPublishers() external view returns (address[] memory);
    function getPublishers(uint256 offset, uint256 limit) external view returns (address[] memory);
}
