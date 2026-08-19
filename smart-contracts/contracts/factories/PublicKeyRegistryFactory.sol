// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PublicKeyRegistry} from "../PublicKeyRegistry.sol";
import {IPublicKeyRegistry} from "../interfaces/IPublicKeyRegistry.sol";
import {IPublicKeyRegistryFactory} from "./interfaces/IPublicKeyRegistryFactory.sol";

contract PublicKeyRegistryFactory is IPublicKeyRegistryFactory {
    function createPublicKeyRegistry() external override returns (IPublicKeyRegistry publicKeyRegistry) {
        publicKeyRegistry = new PublicKeyRegistry();
    }
}
