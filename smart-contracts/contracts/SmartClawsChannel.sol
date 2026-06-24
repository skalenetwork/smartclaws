// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Pagination} from "./Pagination.sol";
import {ISmartClawsChannel} from "./interfaces/ISmartClawsChannel.sol";
import {InvalidRegistryAddress} from "./Errors.sol";

/**
 * @title SmartClawsChannel
 * @notice Append-only message log with circular buffer pruning based on byte capacity.
 * @dev Messages are stored as opaque byte payloads with monotonically increasing offsets.
 *      When total stored bytes exceed `maxCapacityBytes`, the oldest messages are pruned.
 *
 *      Two independent write gates exist and they compose:
 *        - `writesEnabled` (disableWrites): permanent, terminal decommission.
 *        - Pausable `paused()` (pause/unpause): reversible, temporary suspension.
 *      A publish requires writes enabled AND not paused. The permanent gate
 *      dominates: unpausing never re-enables a channel that was disableWrites'd.
 *      Reads remain functional in every state.
 */
contract SmartClawsChannel is Ownable, Pausable, ISmartClawsChannel {
    using EnumerableSet for EnumerableSet.AddressSet;
    using Pagination for EnumerableSet.AddressSet;

    // --- State ---

    address public immutable override registry;
    uint256 public immutable override maxCapacityBytes;

    uint256 public override totalBytes;
    uint256 public override startOffset;
    uint256 public override nextOffset;
    bool public override writesEnabled = true;

    mapping(uint256 offset => bytes payload) private _messages;
    mapping(uint256 offset => uint256 size) private _messageSizes;
    EnumerableSet.AddressSet private _publishers;

    // --- Modifiers ---

    modifier whenWritesEnabled() {
        require(writesEnabled, WritesAreDisabled());
        _;
    }

    modifier onlyAuthorized() {
        require(msg.sender == owner() || _publishers.contains(msg.sender), Unauthorized());
        _;
    }

    modifier onlyOwnerOrRegistry() {
        require(msg.sender == owner() || msg.sender == registry, Unauthorized());
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
        require(registry_ != address(0), InvalidRegistryAddress(address(0)));
        require(maxCapacityBytes_ != 0, ZeroCapacity());

        registry = registry_;
        maxCapacityBytes = maxCapacityBytes_;
    }

    // --- Write Operations ---

    /**
     * @notice Permanently disables future writes. Reads remain functional.
     * @dev Callable by owner or registry (for unregistration flows).
     */
    function disableWrites() external override onlyOwnerOrRegistry {
        if (!writesEnabled) return;
        writesEnabled = false;
        emit WritesDisabled(address(this));
    }

    /**
     * @notice Temporarily suspends writes. Reversible via {unpause}. Reads still work.
     * @dev Independent of {disableWrites}; the permanent gate dominates.
     */
    function pause() external override onlyOwnerOrRegistry {
        _pause();
    }

    /**
     * @notice Lifts a temporary suspension set by {pause}.
     * @dev Does not affect {disableWrites}: a decommissioned channel stays read-only.
     */
    function unpause() external override onlyOwnerOrRegistry {
        _unpause();
    }

    /**
     * @notice Appends a message to the channel.
     * @dev Prunes oldest messages if adding the payload would exceed capacity.
     *      Reverts if the single payload is larger than the entire channel capacity.
     * @param payload The message bytes to store.
     */
    function publishMessage(
        bytes calldata payload
    ) external override whenWritesEnabled whenNotPaused onlyAuthorized {
        uint256 pSize = payload.length;
        require(pSize != 0, EmptyPayload());
        require(pSize <= maxCapacityBytes, PayloadExceedsCapacity(pSize, maxCapacityBytes));

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

    /**
     * @notice Manually evicts up to `maxMessages` of the oldest stored messages.
     * @dev Maintenance escape hatch: auto-pruning on publish is O(eviction count),
     *      so a channel packed with many tiny messages could make a later large
     *      publish exceed the block gas limit. An owner/registry can call this
     *      first (in bounded, caller-sized batches) to trim the backlog so the
     *      publish has room. Independent of the pause/disable gates — it only
     *      advances the read window and frees storage; readers of evicted offsets
     *      get MessagePruned thereafter.
     * @param maxMessages Upper bound on messages to evict this call (gas control).
     * @return pruned Number of messages actually evicted.
     */
    function prune(uint256 maxMessages) external override onlyOwner returns (uint256 pruned) {
        while (pruned < maxMessages && startOffset < nextOffset) {
            totalBytes -= _messageSizes[startOffset];
            delete _messages[startOffset];
            delete _messageSizes[startOffset];
            unchecked {
                ++startOffset;
                ++pruned;
            }
        }
        if (pruned != 0) emit MessagesPruned(address(this), startOffset, pruned);
    }

    // --- Publisher Management ---

    /**
     * @notice Grants write access to an address.
     * @param publisher Address to authorize.
     */
    function addPublisher(address publisher) external override onlyOwner {
        require(publisher != owner(), CannotModifyOwnerAsPublisher());
        require(_publishers.add(publisher), PublisherAlreadyAuthorized(publisher));
        emit PublisherAdded(publisher);
    }

    /**
     * @notice Revokes write access from an address.
     * @param publisher Address to deauthorize.
     */
    function removePublisher(address publisher) external override onlyOwner {
        require(publisher != owner(), CannotModifyOwnerAsPublisher());
        require(_publishers.remove(publisher), PublisherNotAuthorized(publisher));
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
    ) external view override returns (bytes memory payload) {
        require(nextOffset != 0, ChannelEmpty());
        require(offset < nextOffset, InvalidOffset(offset, nextOffset));
        require(offset >= startOffset, MessagePruned(offset, startOffset));
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
    ) external view override returns (bytes[] memory payloads, uint256[] memory offsets) {
        require(nextOffset != 0, ChannelEmpty());
        require(fromOffset >= startOffset, MessagePruned(fromOffset, startOffset));
        require(fromOffset < nextOffset, InvalidOffset(fromOffset, nextOffset));

        uint256 available = nextOffset - fromOffset;
        require(count <= available, BatchTooLarge(count, available));

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
    function getLatestMessageOffset() external view override returns (uint256) {
        require(nextOffset != 0 && nextOffset > startOffset, ChannelEmpty());
        return nextOffset - 1;
    }

    /**
     * @notice Returns the offset of the oldest available (non-pruned) message.
     */
    function getOldestMessageOffset() external view override returns (uint256) {
        require(nextOffset != 0 && nextOffset > startOffset, ChannelEmpty());
        return startOffset;
    }

    /**
     * @notice Returns the number of messages currently stored.
     */
    function getMessageCount() external view override returns (uint256) {
        if (nextOffset <= startOffset) return 0;
        return nextOffset - startOffset;
    }

    /**
     * @notice Checks whether an address is authorized to publish.
     * @param account Address to check.
     * @return True if the address is the owner or an authorized publisher.
     */
    function isAuthorizedPublisher(address account) external view override returns (bool) {
        return account == owner() || _publishers.contains(account);
    }

    /**
     * @notice Returns all authorized publisher addresses (excludes owner).
     */
    function getPublishers() external view override returns (address[] memory) {
        return _publishers.values();
    }

    /**
     * @notice Returns up to `limit` authorized publishers starting at `offset`.
     */
    function getPublishers(
        uint256 offset,
        uint256 limit
    ) external view override returns (address[] memory) {
        return _publishers.slice(offset, limit);
    }
}
