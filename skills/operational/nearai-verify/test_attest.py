#!/usr/bin/env python3
"""Focused security regression tests for the NEAR AI attestation verifier."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("attest.py")
SPEC = importlib.util.spec_from_file_location("nearai_verify_attest", MODULE_PATH)
assert SPEC and SPEC.loader
attest = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(attest)


class FakeVerifiedReport:
    def __init__(self, report_data: str):
        self.status = "UpToDate"
        self.advisory_ids = []
        self._report_data = report_data

    def to_json(self) -> str:
        return json.dumps({
            "status": self.status,
            "advisory_ids": self.advisory_ids,
            "report": {"TD10": {"report_data": self._report_data}},
        })


class ReportDataBindingTests(unittest.TestCase):
    address = "0x11223344556677889900aabbccddeeff00112233"
    nonce = "ab" * 32

    def standard_report_data(self, address: str | None = None, nonce: str | None = None) -> str:
        address_bytes = bytes.fromhex((address or self.address).removeprefix("0x"))
        return (address_bytes + bytes(32 - len(address_bytes))).hex() + (nonce or self.nonce)

    def test_extracts_report_data_from_verified_qvl_result(self):
        expected = self.standard_report_data()
        self.assertEqual(
            attest.extract_verified_report_data(FakeVerifiedReport(expected)),
            expected,
        )

    def test_does_not_trust_lookalike_report_data_outside_verified_quote(self):
        class LookalikeResult:
            def to_json(inner_self) -> str:
                return json.dumps({
                    "report_data": self.standard_report_data(),
                    "report": {"TD10": {}},
                })

        self.assertIsNone(attest.extract_verified_report_data(LookalikeResult()))

    def test_accepts_verified_signer_and_nonce_binding(self):
        ok, _ = attest.verify_report_data_binding(
            self.standard_report_data(),
            {"signing_address": self.address, "signing_algo": "ecdsa"},
            self.nonce,
        )
        self.assertTrue(ok)

    def test_rejects_attacker_controlled_top_level_signer_not_bound_in_quote(self):
        other = "0xaabbccddeeff0011223344556677889900aabbcc"
        ok, _ = attest.verify_report_data_binding(
            self.standard_report_data(address=other),
            {"signing_address": self.address, "signing_algo": "ecdsa"},
            self.nonce,
        )
        self.assertFalse(ok)

    def test_rejects_stale_nonce_in_verified_quote(self):
        ok, _ = attest.verify_report_data_binding(
            self.standard_report_data(nonce="cd" * 32),
            {"signing_address": self.address, "signing_algo": "ecdsa"},
            self.nonce,
        )
        self.assertFalse(ok)

    def test_rejects_malformed_verified_report_data(self):
        ok, _ = attest.verify_report_data_binding(
            "00",
            {"signing_address": self.address, "signing_algo": "ecdsa"},
            self.nonce,
        )
        self.assertFalse(ok)

    def test_accepts_tls_fingerprint_binding_mode(self):
        fingerprint = "42" * 32
        first = hashlib.sha256(
            bytes.fromhex(self.address.removeprefix("0x"))
            + bytes.fromhex(fingerprint)
        ).hexdigest()
        ok, _ = attest.verify_report_data_binding(
            first + self.nonce,
            {
                "signing_address": self.address,
                "signing_algo": "ecdsa",
                "tls_cert_fingerprint": fingerprint,
            },
            self.nonce,
        )
        self.assertTrue(ok)


class NvidiaVerdictTests(unittest.TestCase):
    def test_accepts_boolean_true(self):
        self.assertTrue(attest.nvidia_verdict_passed(True))

    def test_rejects_boolean_false_and_truthy_false_string(self):
        self.assertFalse(attest.nvidia_verdict_passed(False))
        self.assertFalse(attest.nvidia_verdict_passed("false"))
        self.assertFalse(attest.nvidia_verdict_passed(1))

    def test_accepts_documented_pass_string_variants_only(self):
        self.assertTrue(attest.nvidia_verdict_passed("PASS"))
        self.assertTrue(attest.nvidia_verdict_passed("true"))
        self.assertFalse(attest.nvidia_verdict_passed("warning"))


if __name__ == "__main__":
    unittest.main()
