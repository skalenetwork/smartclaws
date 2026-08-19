// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SmartClawsChannelEncrypted} from "../SmartClawsChannelEncrypted.sol";
import {ISmartClaws} from "../interfaces/ISmartClaws.sol";
import {ISmartClawsChannel} from "../interfaces/ISmartClawsChannel.sol";
import {IPublicKeyRegistry} from "../interfaces/IPublicKeyRegistry.sol";
import {IChannelFactory} from "./interfaces/IChannelFactory.sol";

contract EncryptedChannelFactory is IChannelFactory {
    function createChannel(
        address initialOwner,
        uint256 maxCapacityBytes,
        address registry
    ) external override returns (ISmartClawsChannel channel) {
        IPublicKeyRegistry publicKeyRegistry = ISmartClaws(registry).publicKeyRegistry();
        channel = new SmartClawsChannelEncrypted(
            initialOwner,
            maxCapacityBytes,
            registry,
            publicKeyRegistry
        );
    }
}
