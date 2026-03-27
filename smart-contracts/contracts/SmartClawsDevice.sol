// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title SmartClawsDevice
 * @notice Represents an individual IoT device with fixed incoming and outgoing channels.
 * @dev Deployed by SmartClawsDeviceGroup during device registration.
 *      The device contract is immutable — channel and publisher changes are
 *      managed at the DeviceGroup level.
 */
contract SmartClawsDevice {
    address public immutable incomingChannel;
    address public immutable outgoingChannel;
    address public immutable publisher;
    address public immutable group;

    error ZeroAddress();

    constructor(
        address incomingChannel_,
        address outgoingChannel_,
        address publisher_,
        address group_
    ) {
        if (incomingChannel_ == address(0)) revert ZeroAddress();
        if (outgoingChannel_ == address(0)) revert ZeroAddress();
        if (publisher_ == address(0)) revert ZeroAddress();
        if (group_ == address(0)) revert ZeroAddress();

        incomingChannel = incomingChannel_;
        outgoingChannel = outgoingChannel_;
        publisher = publisher_;
        group = group_;
    }

    function getIncomingMessagesChannel() external view returns (address) {
        return incomingChannel;
    }

    function getOutgoingMessagesChannel() external view returns (address) {
        return outgoingChannel;
    }
}
