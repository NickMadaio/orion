"""Phase 10: the two security primitives the backend owes Phase 9.

Server-side ownership, and the egress guard. The invariant-level assertions live
in tests/test_v2_security_invariants.py; these are the detailed behaviours behind
them.
"""

from __future__ import annotations

import unittest
from urllib.parse import urlsplit

from backend.egress import ALLOWED_PORTS, ALLOWED_SCHEMES, EgressRefused, Target, check
from backend.ownership import (
    CLIENT_OWNERSHIP_KEYS,
    ClientOwnershipRefused,
    Owner,
    OwnershipViolation,
    Repository,
    Session,
    owner_first_violations,
    resolve_owner,
    strip_client_ownership,
)


MINE = Session("session-0001-aa", "user-nick-0001", "mac-studio-0001")
THEIRS = Session("session-0002-aa", "user-other-0001", "iphone-them-0001")
ALLOWLIST = frozenset({"api.anthropic.com", "www.googleapis.com"})


class OwnerResolutionTests(unittest.TestCase):
    def test_an_owner_comes_from_a_session(self):
        owner = resolve_owner(MINE)
        self.assertEqual(str(owner.user_id), "user-nick-0001")
        self.assertEqual(str(owner.session_id), "session-0001-aa")

    def test_an_owner_cannot_be_made_from_a_payload(self):
        for pretender in ({"user_id": "user-nick-0001"}, "user-nick-0001", None):
            with self.assertRaises(ClientOwnershipRefused):
                resolve_owner(pretender)

    def test_an_owner_cannot_be_constructed_directly(self):
        # A docstring saying "use resolve_owner" is a request. Without a
        # mechanism, a handler doing Owner(payload["user_id"], session_id) passes
        # every check in the module and every test in the suite.
        with self.assertRaises(TypeError):
            Owner("victim-user-001", "session-00000001")
        with self.assertRaises(ClientOwnershipRefused):
            Owner("victim-user-001", "session-00000001", proof=object())

    def test_every_ownership_claim_is_stripped_from_a_payload(self):
        cleaned, stripped = strip_client_ownership(
            {"title": "buy milk", "user_id": "user-other-0001", "owner": "x", "USER": "y",
             "user-id": "z", "User Id": "w", "uid": "v", "sub": "u"}
        )
        self.assertEqual(cleaned, {"title": "buy milk"})
        self.assertEqual(stripped, ("USER", "User Id", "owner", "sub", "uid", "user-id", "user_id"))

    def test_the_stripped_keys_are_returned_so_the_attempt_can_be_audited(self):
        _, stripped = strip_client_ownership({"on_behalf_of": "user-other-0001"})
        self.assertEqual(stripped, ("on_behalf_of",))
        self.assertTrue(CLIENT_OWNERSHIP_KEYS)


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.repository = Repository("task")
        self.mine = resolve_owner(MINE)
        self.theirs = resolve_owner(THEIRS)
        self.repository.put(self.mine, "task-0001-aaaa", {"title": "mine"})

    def test_every_public_method_takes_an_owner_first(self):
        # Structural: a repository with an unscoped read will have it called by
        # something, and the ownership check will live in whichever callers
        # remembered.
        self.assertEqual(owner_first_violations(), [])

    def test_a_repository_cannot_be_read_without_an_owner(self):
        for call in (
            lambda: self.repository.get("user-nick-0001", "task-0001-aaaa"),
            lambda: self.repository.list(None),
            lambda: self.repository.put({"user_id": "user-nick-0001"}, "task-0002-aaaa", {}),
        ):
            with self.assertRaises(OwnershipViolation):
                call()

    def test_another_user_cannot_read_the_record(self):
        with self.assertRaises(KeyError):
            self.repository.get(self.theirs, "task-0001-aaaa")
        self.assertEqual(self.repository.list(self.theirs), ())

    def test_another_users_write_touches_its_own_record_not_yours(self):
        self.repository.put(self.theirs, "task-0001-aaaa", {"title": "theirs"})
        self.assertEqual(self.repository.get(self.mine, "task-0001-aaaa").value["title"], "mine")
        self.assertEqual(self.repository.get(self.theirs, "task-0001-aaaa").value["title"], "theirs")

    def test_an_id_cannot_be_squatted(self):
        # With a global id space, an attacker writing an id first would make the
        # rightful owner's write fail forever.
        fresh = Repository("task")
        fresh.put(self.theirs, "task-0002-aaaa", {"title": "theirs"})
        self.assertEqual(fresh.put(self.mine, "task-0002-aaaa", {"title": "mine"}).value["title"], "mine")

    def test_another_user_cannot_delete_the_record(self):
        with self.assertRaises(KeyError):
            self.repository.delete(self.theirs, "task-0001-aaaa")
        self.assertEqual(self.repository.count(self.mine), 1)

    def test_a_list_shows_only_your_own(self):
        self.repository.put(self.theirs, "task-0002-aaaa", {"title": "theirs"})
        self.assertEqual([str(r.record_id) for r in self.repository.list(self.mine)], ["task-0001-aaaa"])
        self.assertEqual([str(r.record_id) for r in self.repository.list(self.theirs)], ["task-0002-aaaa"])

    def test_another_user_gets_the_same_answer_for_yours_and_for_nothing(self):
        # Distinguishing "not yours" from "not found" makes ids enumerable.
        missing = self.assertRaises(KeyError)
        with missing:
            self.repository.get(self.theirs, "task-9999-zzzz")
        first = str(missing.exception)
        with self.assertRaises(KeyError) as existing:
            self.repository.get(self.theirs, "task-0001-aaaa")
        self.assertEqual(type(existing.exception), type(missing.exception))
        self.assertEqual(first.split()[0], str(existing.exception).split()[0])


class EgressTests(unittest.TestCase):
    def test_an_allowlisted_host_is_permitted(self):
        target = check("https://api.anthropic.com/v1/messages", allowlist=ALLOWLIST)
        self.assertIsInstance(target, Target)
        self.assertEqual(target.host, "api.anthropic.com")
        self.assertEqual(target.port, 443)

    def test_an_empty_allowlist_fetches_nothing(self):
        with self.assertRaises(EgressRefused):
            check("https://api.anthropic.com/v1/messages")

    def test_only_https_on_the_standard_port(self):
        self.assertEqual(ALLOWED_SCHEMES, frozenset({"https"}))
        self.assertEqual(ALLOWED_PORTS, frozenset({443}))
        for url in ("http://api.anthropic.com/", "https://api.anthropic.com:8443/", "ftp://api.anthropic.com/"):
            with self.assertRaises(EgressRefused, msg=url):
                check(url, allowlist=ALLOWLIST)

    def test_credentials_in_a_url_are_refused(self):
        # `https://api.anthropic.com@evil.example.com` is the oldest trick there is.
        for url in (
            "https://user:pass@api.anthropic.com/",
            "https://api.anthropic.com@evil.example.com/",
        ):
            with self.assertRaises(EgressRefused, msg=url):
                check(url, allowlist=ALLOWLIST)

    def test_cloud_metadata_is_refused_in_every_spelling(self):
        for url in (
            "https://169.254.169.254/latest/meta-data/",
            "https://metadata.google.internal/computeMetadata/v1/",
            "https://metadata/computeMetadata/",
            "https://instance-data/latest/",
        ):
            with self.assertRaises(EgressRefused, msg=url):
                check(url, allowlist=ALLOWLIST | {"169.254.169.254", "metadata.google.internal", "metadata", "instance-data"})

    def test_private_and_loopback_addresses_are_refused_even_if_allowlisted(self):
        hosts = ("127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "100.64.3.4", "0.0.0.0")
        for host in hosts:
            with self.assertRaises(EgressRefused, msg=host):
                check(f"https://{host}/", allowlist=frozenset({host}))

    def test_ipv6_loopback_and_mapped_addresses_are_refused(self):
        for host in ("[::1]", "[::ffff:127.0.0.1]", "[fe80::1]", "[fc00::1]"):
            with self.assertRaises(EgressRefused, msg=host):
                check(f"https://{host}/", allowlist=frozenset({host.strip("[]")}))

    def test_internal_names_are_refused(self):
        for host in ("localhost", "db.internal", "svc.cluster.local", "printer.local", "router"):
            with self.assertRaises(EgressRefused, msg=host):
                check(f"https://{host}/", allowlist=frozenset({host}))

    def test_a_unicode_host_that_folds_onto_an_allowlisted_one_is_refused(self):
        # str.lower() folds U+212A KELVIN SIGN to ASCII "k", and urlsplit's
        # `hostname` has already done it by the time you can read it -- so
        # "hoo\u212as.slack.com" arrives looking exactly like the allowlisted
        # host while being a different domain.
        folded = "https://hoo\u212as.slack.com/x"
        self.assertEqual(urlsplit(folded).hostname, "hooks.slack.com")
        with self.assertRaises(EgressRefused):
            check(folded, allowlist=frozenset({"hooks.slack.com"}))

    def test_port_zero_is_not_the_default_port(self):
        with self.assertRaises(EgressRefused):
            check("https://api.anthropic.com:0/", allowlist=ALLOWLIST)

    def test_a_trailing_dot_does_not_evade_the_allowlist(self):
        self.assertEqual(check("https://api.anthropic.com./v1", allowlist=ALLOWLIST).host, "api.anthropic.com")

    def test_a_host_not_on_the_list_is_refused_whatever_it_looks_like(self):
        for url in ("https://evil.example.com/", "https://api.anthropic.com.evil.example.com/"):
            with self.assertRaises(EgressRefused, msg=url):
                check(url, allowlist=ALLOWLIST)


if __name__ == "__main__":
    unittest.main()
