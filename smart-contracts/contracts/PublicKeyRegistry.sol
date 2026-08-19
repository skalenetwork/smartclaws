// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PublicKey} from "@skalenetwork/bite-solidity/types.sol";
import {IPublicKeyRegistry} from "./interfaces/IPublicKeyRegistry.sol";

contract PublicKeyRegistry is IPublicKeyRegistry {
    uint256 private constant SECP256K1_FIELD =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;

    mapping(address account => PublicKey publicKey) private _publicKeys;
    mapping(address account => bool registered) private _registered;

    function registerPublicKey(PublicKey calldata publicKey) external override {
        require(_isValidPublicKey(publicKey.x, publicKey.y), InvalidPublicKey());

        _publicKeys[msg.sender] = publicKey;
        _registered[msg.sender] = true;
        emit PublicKeyRegistered(msg.sender, publicKey.x, publicKey.y);
    }

    function removePublicKey() external override {
        require(_registered[msg.sender], PublicKeyNotRegistered(msg.sender));

        delete _publicKeys[msg.sender];
        delete _registered[msg.sender];
        emit PublicKeyRemoved(msg.sender);
    }

    function hasPublicKey(address account) external view override returns (bool) {
        return _registered[account];
    }

    function getPublicKey(
        address account
    ) external view override returns (PublicKey memory publicKey) {
        require(_registered[account], PublicKeyNotRegistered(account));
        return _publicKeys[account];
    }

    function _isValidPublicKey(bytes32 x, bytes32 y) private pure returns (bool) {
        uint256 xCoordinate = uint256(x);
        uint256 yCoordinate = uint256(y);
        if (xCoordinate >= SECP256K1_FIELD || yCoordinate >= SECP256K1_FIELD) return false;
        if (xCoordinate == 0 && yCoordinate == 0) return false;

        uint256 ySquared = mulmod(yCoordinate, yCoordinate, SECP256K1_FIELD);
        uint256 xCubed = mulmod(
            mulmod(xCoordinate, xCoordinate, SECP256K1_FIELD),
            xCoordinate,
            SECP256K1_FIELD
        );
        return ySquared == addmod(xCubed, 7, SECP256K1_FIELD);
    }
}
