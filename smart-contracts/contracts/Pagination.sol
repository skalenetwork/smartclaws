// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title Pagination
 * @notice Bounded reads over EnumerableSet.AddressSet so callers can page through
 *         large registries instead of fetching an unbounded array in one call.
 * @dev Full enumeration / historical indexing should be done off-chain from events.
 */
library Pagination {
    using EnumerableSet for EnumerableSet.AddressSet;

    /**
     * @notice Returns up to `limit` members starting at index `offset`.
     * @dev Clamps to the set length; returns an empty array when offset >= length.
     *      Overflow-safe (computes the count from the remaining elements).
     */
    function slice(
        EnumerableSet.AddressSet storage set,
        uint256 offset,
        uint256 limit
    ) internal view returns (address[] memory page) {
        uint256 total = set.length();
        if (offset >= total) return new address[](0);

        uint256 remaining = total - offset;
        uint256 n = limit < remaining ? limit : remaining;

        page = new address[](n);
        for (uint256 i = 0; i < n;) {
            page[i] = set.at(offset + i);
            unchecked { ++i; }
        }
    }
}
