// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MockDeviceGroup
 * @notice Minimal stand-in for a device's managing group in unit tests.
 * @dev SmartClawsDevice only calls `active()` on its group (for the liveness
 *      gate), so the mock just exposes a toggleable `active` flag.
 */
contract MockDeviceGroup {
    bool public active = true;

    function setActive(bool value) external {
        active = value;
    }
}
