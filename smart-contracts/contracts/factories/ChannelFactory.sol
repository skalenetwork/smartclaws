// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SmartClawsChannel} from "../SmartClawsChannel.sol";
import {ISmartClawsChannel} from "../interfaces/ISmartClawsChannel.sol";
import {IChannelFactory} from "./interfaces/IChannelFactory.sol";

/**
 * @title ChannelFactory
 * @notice Deploys SmartClawsChannel instances.
 * @dev Isolating `new SmartClawsChannel(...)` here keeps the channel creation
 *      bytecode out of consumer contracts (SmartClaws, agents, device groups),
 *      so they stay comfortably under the EIP-170 contract size limit.
 *
 *      Do NOT consolidate the four factories into one: a combined factory would
 *      embed every contract's creation bytecode and could itself blow the
 *      EIP-170 limit. The split is deliberate, not accidental boilerplate.
 */
contract ChannelFactory is IChannelFactory {
    function createChannel(
        address initialOwner,
        uint256 maxCapacityBytes,
        address registry
    ) external override returns (ISmartClawsChannel channel) {
        channel = new SmartClawsChannel(initialOwner, maxCapacityBytes, registry);
    }
}
