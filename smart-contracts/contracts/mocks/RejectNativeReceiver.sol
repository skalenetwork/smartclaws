// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract RejectNativeReceiver {
    error NativeTransferRejected();

    receive() external payable {
        revert NativeTransferRejected();
    }
}
