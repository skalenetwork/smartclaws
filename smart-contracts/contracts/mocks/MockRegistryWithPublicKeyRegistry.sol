// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPublicKeyRegistry} from "../interfaces/IPublicKeyRegistry.sol";

contract MockRegistryWithPublicKeyRegistry {
    IPublicKeyRegistry public immutable publicKeyRegistry;

    constructor(IPublicKeyRegistry publicKeyRegistry_) {
        publicKeyRegistry = publicKeyRegistry_;
    }
}
