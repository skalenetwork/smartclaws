// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title DeviceRoles
 * @notice Shared AccessControlEnumerable role identifiers for SmartClawsDevice.
 * @dev Defined in one place so both the device and its managing group reference
 *      the exact same role hashes. DEFAULT_ADMIN_ROLE (0x00) is provided by
 *      OpenZeppelin's AccessControlEnumerable and is held by the device's group.
 *
 *      Role hierarchy:
 *        DEFAULT_ADMIN_ROLE (group)  admins -> DEVICE_ADMIN_ROLE
 *        DEVICE_ADMIN_ROLE           admins -> PUBLISHER_ROLE, MASTER_ROLE
 */
library DeviceRoles {
    /// @notice Per-device administrator; manages PUBLISHER_ROLE and MASTER_ROLE.
    bytes32 internal constant DEVICE_ADMIN_ROLE = keccak256("DEVICE_ADMIN_ROLE");
    /// @notice May publish telemetry to the device's outgoing channel.
    bytes32 internal constant PUBLISHER_ROLE = keccak256("PUBLISHER_ROLE");
    /// @notice May publish commands to the device's incoming channel.
    bytes32 internal constant MASTER_ROLE = keccak256("MASTER_ROLE");
}
