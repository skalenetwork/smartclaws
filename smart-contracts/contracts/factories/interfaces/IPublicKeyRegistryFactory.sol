// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPublicKeyRegistry} from "../../interfaces/IPublicKeyRegistry.sol";

interface IPublicKeyRegistryFactory {
    function createPublicKeyRegistry() external returns (IPublicKeyRegistry publicKeyRegistry);
}
