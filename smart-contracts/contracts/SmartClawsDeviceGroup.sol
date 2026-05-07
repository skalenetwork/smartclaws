// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {SmartClawsChannel} from "./SmartClawsChannel.sol";
import {SmartClawsDevice} from "./SmartClawsDevice.sol";

/**
 * @title SmartClawsDeviceGroup
 * @notice Manages registration and lifecycle of devices within a category.
 * @dev The group contract owns all device channels so it can reliably revoke
 *      publishing permissions when a device is unregistered. This is by design —
 *      channel ownership belongs to the group contract, not the human owner.
 */
contract SmartClawsDeviceGroup is Ownable2Step {
    address public immutable registry;
    string public groupName;
    string public skills;
    bool public active = true;

    struct DeviceInfo {
        bool registered;
        address publisher;
        address incomingChannel;
        address outgoingChannel;
    }

    mapping(address device => DeviceInfo) private _deviceInfo;
    address[] private _deviceList;

    event DeviceRegistered(address indexed device, string deviceId);
    event DeviceUnregistered(address indexed device);
    event GroupDeactivated(address indexed group);

    error Unauthorized();
    error GroupInactive();
    error DeviceNotRegistered(address device);

    modifier onlyRegistry() {
        if (msg.sender != registry) revert Unauthorized();
        _;
    }

    constructor(
        address initialOwner,
        string memory name_,
        string memory skills_,
        address registry_
    ) Ownable(initialOwner) {
        if (registry_ == address(0)) revert OwnableInvalidOwner(address(0));

        groupName = name_;
        skills = skills_;
        registry = registry_;
    }

    /**
     * @notice Registers a new device in this group.
     * @dev Creates incoming and outgoing channels owned by this group contract.
     *      The publisher is authorized on the outgoing channel for telemetry.
     * @param deviceId Human-readable device identifier (stored in event only).
     * @param devicePublisher Wallet address that will publish on behalf of this device.
     * @param channelCapacity Byte capacity for both incoming and outgoing channels.
     * @return device Address of the newly deployed SmartClawsDevice contract.
     */
    function registerDevice(
        string calldata deviceId,
        address devicePublisher,
        uint256 channelCapacity
    ) external onlyOwner returns (address device) {
        if (!active) revert GroupInactive();
        if (devicePublisher == address(0)) revert OwnableInvalidOwner(address(0));

        SmartClawsChannel incoming = new SmartClawsChannel(
            address(this),
            channelCapacity,
            registry
        );
        SmartClawsChannel outgoing = new SmartClawsChannel(
            address(this),
            channelCapacity,
            registry
        );

        outgoing.addPublisher(devicePublisher);

        SmartClawsDevice newDevice = new SmartClawsDevice(
            address(incoming),
            address(outgoing),
            devicePublisher,
            address(this)
        );
        device = address(newDevice);

        _deviceInfo[device] = DeviceInfo({
            registered: true,
            publisher: devicePublisher,
            incomingChannel: address(incoming),
            outgoingChannel: address(outgoing)
        });
        _deviceList.push(device);

        emit DeviceRegistered(device, deviceId);
    }

    /**
     * @notice Unregisters a device, revoking its publishing permissions.
     * @dev Revokes publisher from both incoming and outgoing channels.
     *      The device contract and channels remain deployed and readable.
     * @param device Address of the SmartClawsDevice contract.
     */
    function unregisterDevice(address device) external onlyOwner {
        DeviceInfo storage info = _deviceInfo[device];
        if (!info.registered) revert DeviceNotRegistered(device);

        SmartClawsChannel(info.outgoingChannel).removePublisher(info.publisher);

        // try/catch: publisher may not have been added to incoming channel
        try SmartClawsChannel(info.incomingChannel).removePublisher(info.publisher) {} catch {}

        info.registered = false;
        emit DeviceUnregistered(device);
    }

    /**
     * @notice Grants an address write access to a device's incoming channel.
     * @dev Only the group owner can call this. Needed so an external controller
     *      wallet can publish command envelopes to the device incoming channel.
     * @param device Address of the SmartClawsDevice contract.
     * @param publisher Address to authorize on the incoming channel.
     */
    function addIncomingPublisher(address device, address publisher) external onlyOwner {
        DeviceInfo storage info = _deviceInfo[device];
        if (!info.registered) revert DeviceNotRegistered(device);
        SmartClawsChannel(info.incomingChannel).addPublisher(publisher);
    }

    /**
     * @notice Deactivates the group. Called by the registry during unregistration.
     */
    function deactivate() external onlyRegistry {
        if (!active) return;
        active = false;
        emit GroupDeactivated(address(this));
    }

    // --- View Functions ---

    function getDeviceInfo(
        address device
    ) external view returns (DeviceInfo memory) {
        return _deviceInfo[device];
    }

    function getDevices() external view returns (address[] memory) {
        return _deviceList;
    }

    function getDeviceCount() external view returns (uint256) {
        return _deviceList.length;
    }
}
