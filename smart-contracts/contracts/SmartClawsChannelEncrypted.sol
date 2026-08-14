// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {DoubleEndedQueue} from "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";
import {IBiteSupplicant} from "@skalenetwork/bite-solidity/interfaces/IBiteSupplicant.sol";
import {BITE} from "@skalenetwork/bite-solidity/BITE.sol";
import {PublicKey} from "@skalenetwork/bite-solidity/types.sol";
import {Pagination} from "./Pagination.sol";
import {ISmartClawsChannelEncrypted} from "./interfaces/ISmartClawsChannelEncrypted.sol";
import {IPublicKeyRegistry} from "./interfaces/IPublicKeyRegistry.sol";
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
contract SmartClawsChannelEncrypted is Ownable, Pausable, IBiteSupplicant, ISmartClawsChannelEncrypted {
    using Address for address payable;
    using EnumerableSet for EnumerableSet.AddressSet;
    using DoubleEndedQueue for DoubleEndedQueue.Bytes32Deque;
    using Pagination for EnumerableSet.AddressSet;

    // --- State ---

    uint256 public constant MAX_READ_BATCH = 10;
    uint256 public constant PUBLISH_CALLBACK_BASE_GAS = 150_000;
    uint256 public constant PUBLISH_CALLBACK_GAS_PER_BYTE = 800;
    uint256 public constant READ_CALLBACK_BASE_GAS = 55_000;
    uint256 public constant READ_CALLBACK_GAS_PER_BYTE = 65;
    uint256 public constant READ_CALLBACK_GAS_PER_MESSAGE = 50_000;
    uint8 private constant PUBLISH_ACTION = 0;
    uint8 private constant READ_ACTION = 1;

    address public immutable override registry;
    IPublicKeyRegistry public immutable publicKeyRegistry;
    uint256 public immutable override maxCapacityBytes;

    uint256 public override totalBytes;
    uint256 public override startOffset;
    uint256 public override nextOffset;
    bool public override writesEnabled = true;

    mapping(uint256 offset => bytes payload) private _messages;
    mapping(uint256 offset => uint256 size) private _messageSizes;
    EnumerableSet.AddressSet private _publishers;
    EnumerableSet.AddressSet private _readers;
    EnumerableSet.AddressSet private _callbackSenders;
    DoubleEndedQueue.Bytes32Deque private toRefund;

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
        address registry_,
        IPublicKeyRegistry publicKeyRegistry_
    ) Ownable(initialOwner) {
        require(registry_ != address(0), InvalidRegistryAddress(address(0)));
        require(address(publicKeyRegistry_) != address(0), InvalidRegistryAddress(address(0)));
        require(maxCapacityBytes_ != 0, ZeroCapacity());

        registry = registry_;
        publicKeyRegistry = publicKeyRegistry_;
        maxCapacityBytes = maxCapacityBytes_;
    }

    // --- Write Operations ---

    function onDecrypt(bytes[] calldata decryptedArguments, bytes[] calldata plaintextArguments) external override {
        require(_callbackSenders.remove(msg.sender), CallbackSenderNotAuthorized(msg.sender));
        require(plaintextArguments.length == 3, InvalidCallbackArguments());

        uint8 action = abi.decode(plaintextArguments[0], (uint8));
        if (action == PUBLISH_ACTION) {
            _completePublish(decryptedArguments, plaintextArguments[1]);
        } else if (action == READ_ACTION) {
            _completeRead(decryptedArguments, plaintextArguments[1]);
        } else {
            revert InvalidCallbackArguments();
        }

        // The protocol credits this callback's unused gas only after it returns.
        // Settle the previous payer first, then retain this payer for the next callback.
        _refundPreviousPayer();
        _enqueue(abi.decode(plaintextArguments[2], (address)));
    }

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
    ) external payable override whenWritesEnabled whenNotPaused onlyAuthorized {
        _requestPublish(payload, msg.sender, msg.sender, msg.sender);
    }

    function publishMessageFor(
        bytes calldata payload,
        address refundRecipient
    ) external payable override whenWritesEnabled whenNotPaused onlyOwner {
        require(refundRecipient != address(0), Unauthorized());
        _requestPublish(payload, msg.sender, refundRecipient, refundRecipient);
    }

    function requestMessages(uint256 fromOffset, uint256 count) external payable override {
        require(_readers.contains(msg.sender), ReaderNotAuthorized(msg.sender));
        require(count != 0, InvalidCallbackArguments());
        require(count <= MAX_READ_BATCH, ReadBatchLimitExceeded(count, MAX_READ_BATCH));
        require(nextOffset != 0, ChannelEmpty());
        require(fromOffset >= startOffset, MessagePruned(fromOffset, startOffset));
        require(fromOffset < nextOffset, InvalidOffset(fromOffset, nextOffset));

        uint256 available = nextOffset - fromOffset;
        require(count <= available, BatchTooLarge(count, available));

        PublicKey memory publicKey = publicKeyRegistry.getPublicKey(msg.sender);
        bytes[] memory encryptedArguments = new bytes[](count);
        uint256[] memory offsets = new uint256[](count);
        uint256 totalEncryptedPayloadSize;
        for (uint256 i = 0; i < count;) {
            uint256 offset = fromOffset + i;
            encryptedArguments[i] = _messages[offset];
            totalEncryptedPayloadSize += encryptedArguments[i].length;
            offsets[i] = offset;
            unchecked { ++i; }
        }

        bytes[] memory plaintextArguments = new bytes[](3);
        plaintextArguments[0] = abi.encode(READ_ACTION);
        plaintextArguments[1] = abi.encode(
            msg.sender,
            publicKey.x,
            publicKey.y,
            offsets
        );
        plaintextArguments[2] = abi.encode(msg.sender);
        _submitCTX(
            encryptedArguments,
            plaintextArguments,
            getReadCallbackGas(totalEncryptedPayloadSize, count)
        );
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

    function addReader(address reader) external override onlyOwner {
        require(_readers.add(reader), ReaderAlreadyAuthorized(reader));
        emit ReaderAdded(reader);
    }

    function removeReader(address reader) external override onlyOwner {
        require(_readers.remove(reader), ReaderNotAuthorized(reader));
        emit ReaderRemoved(reader);
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

    function isAuthorizedReader(address account) external view override returns (bool) {
        return _readers.contains(account);
    }

    function getReaders() external view override returns (address[] memory) {
        return _readers.values();
    }

    function getReaders(
        uint256 offset,
        uint256 limit
    ) external view override returns (address[] memory) {
        return _readers.slice(offset, limit);
    }

    function hasToRefund() external view returns (bool) {
        return !toRefund.empty() && toRefund.front() != bytes32(0);
    }

    // --- Pure Operations ---

    function isEncrypted() external pure override returns (bool) {
        return true;
    }

    function getPublishCallbackGas(
        uint256 encryptedPayloadSize
    ) public pure override returns (uint256) {
        return PUBLISH_CALLBACK_BASE_GAS + encryptedPayloadSize * PUBLISH_CALLBACK_GAS_PER_BYTE;
    }

    function getReadCallbackGas(
        uint256 totalEncryptedPayloadSize,
        uint256 count
    ) public pure override returns (uint256) {
        return
            READ_CALLBACK_BASE_GAS +
            totalEncryptedPayloadSize * READ_CALLBACK_GAS_PER_BYTE +
            count * READ_CALLBACK_GAS_PER_MESSAGE;
    }

    function _requestPublish(
        bytes calldata payload,
        address authorizedPublisher,
        address encryptedPublisher,
        address refundRecipient
    ) private {
        require(payload.length > BITE.TE_RETURN_SIZE_THRESHOLD, InvalidEncryptedPayload());
        uint256 canonicalStoredCiphertextSize = _canonicalStoredCiphertextSize(payload.length);
        require(
            canonicalStoredCiphertextSize <= maxCapacityBytes,
            PayloadExceedsCapacity(canonicalStoredCiphertextSize, maxCapacityBytes)
        );

        bytes[] memory encryptedArguments = new bytes[](1);
        encryptedArguments[0] = payload;
        bytes[] memory plaintextArguments = new bytes[](3);
        plaintextArguments[0] = abi.encode(PUBLISH_ACTION);
        plaintextArguments[1] = abi.encode(authorizedPublisher, encryptedPublisher);
        plaintextArguments[2] = abi.encode(refundRecipient);
        _submitCTX(
            encryptedArguments,
            plaintextArguments,
            getPublishCallbackGas(payload.length)
        );
    }

    function _canonicalStoredCiphertextSize(
        uint256 submittedCiphertextSize
    ) private pure returns (uint256) {
        // submitted payload decrypts to abi.encode(address, bytes), but storage
        // re-encrypts abi.encode(bytes). For the same inner payload this removes
        // one 32-byte word from plaintext, therefore ciphertext shrinks by 32.
        unchecked {
            return submittedCiphertextSize - 32;
        }
    }

    function _publishMessage(bytes memory payload) private {
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

    function _enqueue(address account) private {
        toRefund.pushBack(bytes32(uint256(uint160(account))));
    }

    function _dequeue() private returns (address) {
        bytes32 value = toRefund.popFront();
        return address(uint160(uint256(value)));
    }

    function _submitCTX(
        bytes[] memory encryptedArguments,
        bytes[] memory plaintextArguments,
        uint256 callbackGas
    ) private {
        uint256 requiredFee = callbackGas * tx.gasprice;
        require(
            msg.value >= requiredFee,
            InsufficientCallbackFee(requiredFee, msg.value)
        );
        address payable callbackSender = BITE.submitCTX(
            callbackGas,
            encryptedArguments,
            plaintextArguments
        );
        assert(_callbackSenders.add(callbackSender));
        callbackSender.sendValue(msg.value);
    }

    function _completePublish(
        bytes[] calldata decryptedArguments,
        bytes calldata encodedContext
    ) private {
        require(decryptedArguments.length == 1, InvalidCallbackArguments());
        (address authorizedPublisher, address expectedEncryptedPublisher) = abi.decode(
            encodedContext,
            (address, address)
        );
        (address encryptedPublisher, bytes memory payload) = abi.decode(
            decryptedArguments[0],
            (address, bytes)
        );
        require(writesEnabled, WritesAreDisabled());
        _requireNotPaused();
        require(
            authorizedPublisher == owner() || _publishers.contains(authorizedPublisher),
            Unauthorized()
        );
        require(
            encryptedPublisher == expectedEncryptedPublisher,
            EncryptedPublisherMismatch(expectedEncryptedPublisher, encryptedPublisher)
        );

        _publishMessage(BITE.encryptTE(abi.encode(payload)));
    }

    function _completeRead(
        bytes[] calldata decryptedArguments,
        bytes calldata encodedContext
    ) private {
        (
            address reader,
            bytes32 keyX,
            bytes32 keyY,
            uint256[] memory offsets
        ) = abi.decode(encodedContext, (address, bytes32, bytes32, uint256[]));
        require(_readers.contains(reader), ReaderNotAuthorized(reader));
        require(
            decryptedArguments.length == offsets.length && offsets.length <= MAX_READ_BATCH,
            InvalidCallbackArguments()
        );

        PublicKey memory publicKey = PublicKey({x: keyX, y: keyY});
        for (uint256 i = 0; i < offsets.length;) {
            bytes memory payload = abi.decode(decryptedArguments[i], (bytes));
            bytes memory encryptedPayload = BITE.encryptECIES(payload, publicKey);
            emit MessageDisclosed(address(this), reader, offsets[i], encryptedPayload);
            unchecked { ++i; }
        }
    }

    function _refundPreviousPayer() private {
        if (toRefund.empty()) return;

        // Always advance the queue. A zero balance means refunds are unavailable,
        // not that this payer should remain and receive a later callback's refund.
        address recipient = _dequeue();
        uint256 refund = address(this).balance;
        if (refund == 0) return;

        (bool sent,) = payable(recipient).call{value: refund, gas: 2300}("");
        if (!sent) {
            payable(address(0)).sendValue(refund);
        }
    }
}
