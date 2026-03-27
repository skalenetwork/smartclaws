// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title SmartClawsChannel
 * @notice Append-only message log with circular buffer pruning based on byte capacity.
 * @dev Messages are stored as opaque byte payloads with monotonically increasing offsets.
 *      When total stored bytes exceed `maxCapacityBytes`, the oldest messages are pruned.
 *      Writes can be permanently disabled while preserving read access.
 */
contract SmartClawsChannel is Ownable2Step {
    using EnumerableSet for EnumerableSet.AddressSet;

    // --- State ---

    address public immutable registry;
    uint256 public immutable maxCapacityBytes;

    uint256 public totalBytes;
    uint256 public startOffset;
    uint256 public nextOffset;
    bool public writesEnabled = true;

    mapping(uint256 offset => bytes payload) private _messages;
    mapping(uint256 offset => uint256 size) private _messageSizes;
    EnumerableSet.AddressSet private _publishers;

    // --- Events ---

    event MessagePublished(address indexed channel, uint256 indexed offset);
    event WritesDisabled(address indexed channel);
    event PublisherAdded(address indexed publisher);
    event PublisherRemoved(address indexed publisher);

    // --- Errors ---

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
    error ZeroRegistry();
    error ZeroCapacity();

    // --- Modifiers ---

    modifier whenWritesEnabled() {
        if (!writesEnabled) revert WritesAreDisabled();
        _;
    }

    modifier onlyAuthorized() {
        if (msg.sender != owner() && !_publishers.contains(msg.sender)) {
            revert Unauthorized();
        }
        _;
    }

    modifier onlyOwnerOrRegistry() {
        if (msg.sender != owner() && msg.sender != registry) {
            revert Unauthorized();
        }
        _;
    }

    // --- Constructor ---

    /**
     * @param initialOwner Address granted administrative control of this channel.
     * @param maxCapacityBytes_ Total byte limit for stored messages before pruning begins.
     * @param registry_ Address of the SmartClaws registry contract.
     */
    constructor(
        address initialOwner,
        uint256 maxCapacityBytes_,
        address registry_
    ) Ownable(initialOwner) {
        if (registry_ == address(0)) revert ZeroRegistry();
        if (maxCapacityBytes_ == 0) revert ZeroCapacity();

        registry = registry_;
        maxCapacityBytes = maxCapacityBytes_;
    }

    // --- Write Operations ---

    /**
     * @notice Permanently disables future writes. Reads remain functional.
     * @dev Callable by owner or registry (for unregistration flows).
     */
    function disableWrites() external onlyOwnerOrRegistry {
        if (!writesEnabled) return;
        writesEnabled = false;
        emit WritesDisabled(address(this));
    }

    /**
     * @notice Appends a message to the channel.
     * @dev Prunes oldest messages if adding the payload would exceed capacity.
     *      Reverts if the single payload is larger than the entire channel capacity.
     * @param payload The message bytes to store.
     */
    function publishMessage(
        bytes calldata payload
    ) external whenWritesEnabled onlyAuthorized {
        uint256 pSize = payload.length;
        if (pSize == 0) revert EmptyPayload();
        if (pSize > maxCapacityBytes) {
            revert PayloadExceedsCapacity(pSize, maxCapacityBytes);
        }

        // Prune oldest messages until there is room.
        while (totalBytes + pSize > maxCapacityBytes && startOffset < nextOffset) {
            totalBytes -= _messageSizes[startOffset];
            delete _messages[startOffset];
            delete _messageSizes[startOffset];
            unchecked { ++startOffset; }
        }

        uint256 offset = nextOffset;
        _messages[offset] = payload;
        _messageSizes[offset] = pSize;
        totalBytes += pSize;
        unchecked { ++nextOffset; }

        emit MessagePublished(address(this), offset);
    }

    // --- Publisher Management ---

    /**
     * @notice Grants write access to an address.
     * @param publisher Address to authorize.
     */
    function addPublisher(address publisher) external onlyOwner {
        if (publisher == owner()) revert CannotModifyOwnerAsPublisher();
        bool added = _publishers.add(publisher);
        if (!added) revert PublisherAlreadyAuthorized(publisher);
        emit PublisherAdded(publisher);
    }

    /**
     * @notice Revokes write access from an address.
     * @param publisher Address to deauthorize.
     */
    function removePublisher(address publisher) external onlyOwner {
        if (publisher == owner()) revert CannotModifyOwnerAsPublisher();
        bool removed = _publishers.remove(publisher);
        if (!removed) revert PublisherNotAuthorized(publisher);
        emit PublisherRemoved(publisher);
    }

    // --- Read Operations ---

    /**
     * @notice Returns the message payload at the given offset.
     * @param offset The message offset to read.
     * @return payload The stored bytes.
     */
    function readMessage(
        uint256 offset
    ) external view returns (bytes memory payload) {
        if (nextOffset == 0) revert ChannelEmpty();
        if (offset >= nextOffset) revert InvalidOffset(offset, nextOffset);
        if (offset < startOffset) revert MessagePruned(offset, startOffset);
        return _messages[offset];
    }

    /**
     * @notice Returns a batch of messages starting from `fromOffset`.
     * @dev Reverts if any message in the range has been pruned or doesn't exist.
     * @param fromOffset The starting offset (inclusive).
     * @param count Number of messages to return.
     * @return payloads Array of message bytes.
     * @return offsets Array of corresponding offsets.
     */
    function readMessages(
        uint256 fromOffset,
        uint256 count
    ) external view returns (bytes[] memory payloads, uint256[] memory offsets) {
        if (nextOffset == 0) revert ChannelEmpty();
        if (fromOffset < startOffset) revert MessagePruned(fromOffset, startOffset);
        if (fromOffset >= nextOffset) revert InvalidOffset(fromOffset, nextOffset);

        uint256 available = nextOffset - fromOffset;
        if (count > available) revert BatchTooLarge(count, available);

        payloads = new bytes[](count);
        offsets = new uint256[](count);

        for (uint256 i = 0; i < count;) {
            uint256 offset = fromOffset + i;
            payloads[i] = _messages[offset];
            offsets[i] = offset;
            unchecked { ++i; }
        }
    }

    /**
     * @notice Returns the offset of the most recent message.
     */
    function getLatestMessageOffset() external view returns (uint256) {
        if (nextOffset == 0 || nextOffset <= startOffset) revert ChannelEmpty();
        return nextOffset - 1;
    }

    /**
     * @notice Returns the offset of the oldest available (non-pruned) message.
     */
    function getOldestMessageOffset() external view returns (uint256) {
        if (nextOffset == 0 || nextOffset <= startOffset) revert ChannelEmpty();
        return startOffset;
    }

    /**
     * @notice Returns the number of messages currently stored.
     */
    function getMessageCount() external view returns (uint256) {
        if (nextOffset <= startOffset) return 0;
        return nextOffset - startOffset;
    }

    /**
     * @notice Checks whether an address is authorized to publish.
     * @param account Address to check.
     * @return True if the address is the owner or an authorized publisher.
     */
    function isAuthorizedPublisher(address account) external view returns (bool) {
        return account == owner() || _publishers.contains(account);
    }

    /**
     * @notice Returns all authorized publisher addresses (excludes owner).
     */
    function getPublishers() external view returns (address[] memory) {
        return _publishers.values();
    }

    /**
     * @notice Returns the total byte capacity of this channel.
     */
    function getMaxCapacityBytes() external view returns (uint256) {
        return maxCapacityBytes;
    }
}
