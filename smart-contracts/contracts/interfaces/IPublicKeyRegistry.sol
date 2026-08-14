// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PublicKey} from "@skalenetwork/bite-solidity/types.sol";

interface IPublicKeyRegistry {
    event PublicKeyRegistered(address indexed account, bytes32 x, bytes32 y);
    event PublicKeyRemoved(address indexed account);

    error InvalidPublicKey();
    error PublicKeyNotRegistered(address account);

    function registerPublicKey(PublicKey calldata publicKey) external;
    function removePublicKey() external;
    function hasPublicKey(address account) external view returns (bool);
    function getPublicKey(address account) external view returns (PublicKey memory publicKey);
}
