// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISmartClawsDeviceGroup {
    event DeviceRegistered(address indexed device, string deviceId);
    event DeviceUnregistered(address indexed device);
    event GroupDeactivated(address indexed group);
    event SkillsUpdated(string skills);

    error Unauthorized();
    error GroupInactive();
    error DeviceNotRegistered(address device);

    function registry() external view returns (address);
    function groupName() external view returns (string memory);
    function skills() external view returns (string memory);
    function createdAt() external view returns (uint256);
    function active() external view returns (bool);

    function registerDevice(
        string calldata deviceId,
        address deviceAdmin,
        uint256 channelCapacity
    ) external returns (address device);
    function unregisterDevice(address device) external;
    function setSkills(string calldata skills_) external;

    // Role passthroughs (owner-gated) onto a registered device.
    function grantDeviceAdmin(address device, address account) external;
    function revokeDeviceAdmin(address device, address account) external;
    function grantPublisher(address device, address account) external;
    function revokePublisher(address device, address account) external;
    function grantMaster(address device, address account) external;
    function revokeMaster(address device, address account) external;

    function deactivate() external;

    function isRegisteredDevice(address device) external view returns (bool);
    function getDevices() external view returns (address[] memory);
    function getDevices(uint256 offset, uint256 limit) external view returns (address[] memory);
    function getDeviceCount() external view returns (uint256);
}
