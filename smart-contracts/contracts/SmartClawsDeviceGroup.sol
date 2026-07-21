// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Pagination} from "./Pagination.sol";
import {ISmartClawsDevice} from "./interfaces/ISmartClawsDevice.sol";
import {ISmartClawsDeviceGroup} from "./interfaces/ISmartClawsDeviceGroup.sol";
import {IChannelFactory} from "./factories/interfaces/IChannelFactory.sol";
import {IDeviceFactory} from "./factories/interfaces/IDeviceFactory.sol";
import {DeviceRoles} from "./DeviceRoles.sol";

/**
 * @title SmartClawsDeviceGroup
 * @notice Manages registration and lifecycle of devices within a category.
 * @dev The group is the super-administrator (DEFAULT_ADMIN_ROLE) of every device
 *      it registers, so it can always re-appoint a device's admin. Day-to-day a
 *      device's own DEVICE_ADMIN manages that device directly; the group owner
 *      only needs the passthroughs below when the group itself is the device
 *      admin (deviceAdmin == 0 at registration) or to exercise its override.
 */
contract SmartClawsDeviceGroup is Ownable2Step, ISmartClawsDeviceGroup {
    using EnumerableSet for EnumerableSet.AddressSet;
    using Pagination for EnumerableSet.AddressSet;

    address public immutable override registry;
    IChannelFactory public immutable channelFactory;
    IDeviceFactory public immutable deviceFactory;
    string public override groupName;
    string public override skills;
    uint256 public immutable override createdAt;
    bool public override active = true;

    // Currently-registered devices. Decommissioned devices are removed (their
    // history lives in events; the device/channel contracts persist on-chain).
    EnumerableSet.AddressSet private _devices;

    modifier onlyRegistry() {
        require(msg.sender == registry, Unauthorized());
        _;
    }

    constructor(
        address initialOwner,
        string memory name_,
        string memory skills_,
        address registry_,
        IChannelFactory channelFactory_,
        IDeviceFactory deviceFactory_
    ) Ownable(initialOwner) {
        require(registry_ != address(0), OwnableInvalidOwner(address(0)));

        groupName = name_;
        skills = skills_;
        createdAt = block.timestamp;
        registry = registry_;
        channelFactory = channelFactory_;
        deviceFactory = deviceFactory_;
    }

    /**
     * @notice Updates the group's skills descriptor (e.g. SKILLS.md content or hash).
     * @dev Owner-gated. `groupName` stays immutable-by-design; only skills evolve.
     * @param skills_ New capability description.
     */
    function setSkills(string calldata skills_) external override onlyOwner {
        skills = skills_;
        emit SkillsUpdated(skills_);
    }

    /**
     * @notice Registers a new device in this group.
     * @dev The group is pinned as the device's DEFAULT_ADMIN (super-authority).
     *      `deviceAdmin == 0` makes the group the device admin too (single-tier).
     *      PUBLISHER_ROLE / MASTER_ROLE start empty and are granted later.
     * @param deviceId Human-readable device identifier (stored in event only).
     * @param deviceAdmin Per-device administrator, or address(0) for group-only control.
     * @param channelCapacity Byte capacity for both incoming and outgoing channels.
     * @return device Address of the newly deployed SmartClawsDevice contract.
     */
    function registerDevice(
        string calldata deviceId,
        address deviceAdmin,
        uint256 channelCapacity
    ) external override onlyOwner returns (address device) {
        require(active, GroupInactive());

        address admin = deviceAdmin == address(0) ? address(this) : deviceAdmin;
        device = address(
            deviceFactory.createDevice(address(this), admin, registry, channelFactory, channelCapacity, deviceId)
        );

        assert(_devices.add(device));

        emit DeviceRegistered(device, deviceId);
    }

    /**
     * @notice Decommissions a device, permanently disabling its channel writes.
     * @dev The device contract and channels remain deployed and readable.
     * @param device Address of the SmartClawsDevice contract.
     */
    function unregisterDevice(address device) external override onlyOwner {
        _requireRegistered(device);
        ISmartClawsDevice(device).deactivate();
        assert(_devices.remove(device));
        emit DeviceUnregistered(device);
    }

    // --- Role passthroughs (DEFAULT_ADMIN actions, owner-gated) ---
    // grant/revoke of PUBLISHER_ROLE and MASTER_ROLE succeed only while the group
    // actually holds DEVICE_ADMIN_ROLE on the device (the deviceAdmin == 0 case,
    // or after the group re-appoints itself via grantDeviceAdmin). AccessControl
    // enforces this; otherwise it reverts with AccessControlUnauthorizedAccount.

    function grantDeviceAdmin(address device, address account) external override onlyOwner {
        _requireRegistered(device);
        ISmartClawsDevice(device).grantRole(DeviceRoles.DEVICE_ADMIN_ROLE, account);
    }

    function revokeDeviceAdmin(address device, address account) external override onlyOwner {
        _requireRegistered(device);
        ISmartClawsDevice(device).revokeRole(DeviceRoles.DEVICE_ADMIN_ROLE, account);
    }

    function grantPublisher(address device, address account) external override onlyOwner {
        _requireRegistered(device);
        ISmartClawsDevice(device).grantRole(DeviceRoles.PUBLISHER_ROLE, account);
    }

    function revokePublisher(address device, address account) external override onlyOwner {
        _requireRegistered(device);
        ISmartClawsDevice(device).revokeRole(DeviceRoles.PUBLISHER_ROLE, account);
    }

    function grantMaster(address device, address account) external override onlyOwner {
        _requireRegistered(device);
        ISmartClawsDevice(device).grantRole(DeviceRoles.MASTER_ROLE, account);
    }

    function revokeMaster(address device, address account) external override onlyOwner {
        _requireRegistered(device);
        ISmartClawsDevice(device).revokeRole(DeviceRoles.MASTER_ROLE, account);
    }

    /**
     * @notice Deactivates the group. Called by the registry during unregistration.
     */
    function deactivate() external override onlyRegistry {
        if (!active) return;
        active = false;
        emit GroupDeactivated(address(this));
    }

    // --- View Functions ---

    function isRegisteredDevice(address device) external view override returns (bool) {
        return _devices.contains(device);
    }

    function getDevices() external view override returns (address[] memory) {
        return _devices.values();
    }

    function getDevices(
        uint256 offset,
        uint256 limit
    ) external view override returns (address[] memory) {
        return _devices.slice(offset, limit);
    }

    function getDeviceCount() external view override returns (uint256) {
        return _devices.length();
    }

    function _requireRegistered(address device) private view {
        require(_devices.contains(device), DeviceNotRegistered(device));
    }
}
