// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISmartClawsChannel} from "./ISmartClawsChannel.sol";
import {IPublicKeyRegistry} from "./IPublicKeyRegistry.sol";

interface ISmartClawsChannelEncrypted is ISmartClawsChannel {
    event ReaderAdded(address indexed reader);
    event ReaderRemoved(address indexed reader);
    event MessageDisclosed(
        address indexed channel,
        address indexed reader,
        uint256 indexed offset,
        bytes encryptedPayload
    );

    error InvalidEncryptedPayload();
    error EncryptedPublisherMismatch(address expected, address actual);
    error InvalidCallbackArguments();
    error CallbackSenderNotAuthorized(address sender);
    error ReaderAlreadyAuthorized(address reader);
    error ReaderNotAuthorized(address reader);
    error ReadBatchLimitExceeded(uint256 requested, uint256 maximum);
    error InsufficientCallbackFee(uint256 required, uint256 provided);

    function publicKeyRegistry() external view returns (IPublicKeyRegistry);
    function getPublishCallbackGas(uint256 encryptedPayloadSize) external pure returns (uint256);
    function getReadCallbackGas(uint256 totalEncryptedPayloadSize, uint256 count) external pure returns (uint256);
    function publishMessageFor(bytes calldata payload, address refundRecipient) external payable;
    function requestMessages(uint256 fromOffset, uint256 count) external payable;
    function addReader(address reader) external;
    function removeReader(address reader) external;
    function isAuthorizedReader(address account) external view returns (bool);
    function getReaders() external view returns (address[] memory);
    function getReaders(uint256 offset, uint256 limit) external view returns (address[] memory);
}
