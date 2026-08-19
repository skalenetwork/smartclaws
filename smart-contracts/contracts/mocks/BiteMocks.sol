// SPDX-License-Identifier: AGPL-3.0-only
// solhint-disable one-contract-per-file
pragma solidity ^0.8.28;

import {BiteMock} from "@skalenetwork/bite-solidity/test/BiteMock.sol";
import {SubmitCTXMock} from "@skalenetwork/bite-solidity/test/SubmitCTXMock.sol";
import {EncryptTEMock} from "@skalenetwork/bite-solidity/test/EncryptTEMock.sol";
import {EncryptECIESMock} from "@skalenetwork/bite-solidity/test/EncryptECIESMock.sol";

contract TestBiteMock is BiteMock {}

contract TestSubmitCTXMock is SubmitCTXMock {
	constructor(BiteMock bite) SubmitCTXMock(bite) {}
}

contract TestEncryptTEMock is EncryptTEMock {
	constructor(BiteMock bite) EncryptTEMock(bite) {}
}

contract TestEncryptECIESMock is EncryptECIESMock {
	constructor(BiteMock bite) EncryptECIESMock(bite) {}
}
