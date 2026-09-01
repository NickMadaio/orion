"""Phase 22: calendar read integration, the connector broker, and webhooks.

The three rules with teeth, each tested by trying to break them:

- a notification cannot carry calendar content;
- a durable request cannot carry a credential;
- absence in an incremental page is not deletion.
"""

from __future__ import annotations

import unittest
from dataclasses import fields, replace
from datetime import date, datetime, timedelta, timezone

from backend.calendar import availability as avail
from backend.calendar.events import (
    CalendarRefused,
    Event,
    EventStatus,
    Response,
    Transparency,
)
from backend.calendar.read import (
    CalendarSummary,
    EGRESS_ALLOWLIST,
    event_from_provider,
    list_calendars_request,
    list_events_request,
    record_from_event,
)
from backend.connectors import sync
from backend.connectors import webhooks as hooks
from backend.connectors.broker import (
    AuthorizationHeaderRefused,
    Connection,
    ConnectionState,
    ConnectorRefused,
    MAX_REFRESH_ATTEMPTS,
    PreparedRequest,
    SECRET_HEADERS,
    authorized,
    disconnect,
    on_fetch_unauthorized,
    on_grant_revoked,
    on_refresh_failed,
    on_refresh_succeeded,
    reauthorize,
)
from backend.connectors.scopes import (
    CATALOG,
    FEATURE_SCOPES,
    NEVER_REQUESTED,
    Access,
    Feature,
    ScopeRefused,
    access_of,
    check_minimal,
    escalation,
    for_features,
    is_write,
)
from backend.egress import EgressRefused, check as egress_check


NOW = datetime(2026, 8, 25, 12, 0, tzinfo=timezone.utc)
READ_SCOPES = for_features(Feature.CALENDAR_READ)


def connection(**kwargs) -> Connection:
    fields_ = {
        "connection_id": "conn1",
        "user_id": "u1",
        "provider": "google",
        "features": (Feature.CALENDAR_READ,),
        "scopes": READ_SCOPES,
        "credential_ref": "cred1",
    }
    fields_.update(kwargs)
    return Connection(**fields_)


def timed(event_id: str, start_hour: int, end_hour: int, **kwargs) -> Event:
    base = {
        "event_id": event_id,
        "calendar_id": "cal1",
        "summary": "Meeting",
        "starts_at": datetime(2026, 8, 26, start_hour, tzinfo=timezone.utc),
        "ends_at": datetime(2026, 8, 26, end_hour, tzinfo=timezone.utc),
        "transparency": Transparency.OPAQUE,
    }
    base.update(kwargs)
    return Event(**base)


class MinimalScopeTests(unittest.TestCase):
    def test_calendar_read_asks_for_three_narrow_scopes_not_the_broad_one(self):
        self.assertEqual(len(FEATURE_SCOPES[Feature.CALENDAR_READ]), 3)
        self.assertNotIn(
            "https://www.googleapis.com/auth/calendar.readonly",
            FEATURE_SCOPES[Feature.CALENDAR_READ],
        )

    def test_the_broad_scopes_are_recorded_as_deliberately_never_requested(self):
        for scope in (
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://mail.google.com/",
        ):
            with self.subTest(scope=scope):
                self.assertIn(scope, NEVER_REQUESTED)
                with self.assertRaises(ScopeRefused) as caught:
                    access_of(scope)
                self.assertIn(NEVER_REQUESTED[scope][:20], str(caught.exception))

    def test_no_read_feature_holds_a_write_scope(self):
        for feature in (Feature.CALENDAR_READ, Feature.GMAIL_READ):
            with self.subTest(feature=feature):
                for scope in FEATURE_SCOPES[feature]:
                    self.assertFalse(is_write(scope), scope)

    def test_a_write_scope_is_refused_for_a_read_feature(self):
        with self.assertRaises(ScopeRefused):
            check_minimal(
                Feature.CALENDAR_READ,
                ("https://www.googleapis.com/auth/calendar.events",),
            )

    def test_the_ceiling_refuses_a_write_scope_even_when_the_feature_lists_it(self):
        # The membership check masked this guard, so the mutation survived. If
        # a write scope is ever added to a read feature's list, the ceiling --
        # not a reviewer -- is what has to catch it.
        from unittest.mock import patch

        from backend.connectors import scopes as scopes_module

        write_scope = "https://www.googleapis.com/auth/calendar.events"
        widened = dict(scopes_module.FEATURE_SCOPES)
        widened[Feature.CALENDAR_READ] = FEATURE_SCOPES[Feature.CALENDAR_READ] + (write_scope,)
        with patch.object(scopes_module, "FEATURE_SCOPES", widened):
            with self.assertRaises(ScopeRefused) as caught:
                check_minimal(Feature.CALENDAR_READ, (write_scope,))
        self.assertIn("tops out at read", str(caught.exception))

    def test_every_declared_feature_scope_sits_at_or_below_its_ceiling(self):
        from backend.connectors.scopes import FEATURE_CEILING, _ORDER

        for feature, feature_scopes in FEATURE_SCOPES.items():
            ceiling = _ORDER.index(FEATURE_CEILING[feature])
            for scope in feature_scopes:
                with self.subTest(feature=feature, scope=scope):
                    self.assertLessEqual(_ORDER.index(access_of(scope)), ceiling)

    def test_a_scope_belonging_to_another_feature_is_refused(self):
        # gmail.readonly is a READ scope, so the ceiling lets it through. What
        # refuses it is that calendar_read has no use for it -- and a scope
        # nothing needs is one nobody notices is still granted.
        with self.assertRaises(ScopeRefused) as caught:
            check_minimal(
                Feature.CALENDAR_READ, ("https://www.googleapis.com/auth/gmail.readonly",)
            )
        self.assertIn("not part of calendar_read", str(caught.exception))

    def test_an_unknown_scope_has_no_default_classification(self):
        with self.assertRaises(ScopeRefused):
            access_of("https://www.googleapis.com/auth/something.new")

    def test_every_catalog_scope_has_an_access_level(self):
        for scope, access in CATALOG.items():
            with self.subTest(scope=scope):
                self.assertIsInstance(access, Access)

    def test_scope_order_is_stable_so_consent_is_asked_once(self):
        self.assertEqual(
            for_features(Feature.CALENDAR_READ, Feature.GMAIL_READ),
            for_features(Feature.GMAIL_READ, Feature.CALENDAR_READ),
        )

    def test_escalation_asks_only_for_what_is_missing(self):
        held = FEATURE_SCOPES[Feature.CALENDAR_READ]
        wanted = for_features(Feature.CALENDAR_READ, Feature.CALENDAR_WRITE)
        self.assertEqual(
            escalation(held, wanted), ("https://www.googleapis.com/auth/calendar.events",)
        )

    def test_a_connection_may_not_hold_a_scope_no_feature_needs(self):
        with self.assertRaises(ScopeRefused):
            connection(scopes=READ_SCOPES + ("https://www.googleapis.com/auth/gmail.readonly",))

    def test_a_duplicated_scope_is_refused(self):
        with self.assertRaises(ScopeRefused):
            check_minimal(Feature.CALENDAR_READ, READ_SCOPES + (READ_SCOPES[0],))


class CredentialsStayInTheVaultTests(unittest.TestCase):
    class FakeBorrow:
        """The shape of Phase 12's Borrowed, without importing the vault."""

        def __init__(self, value: bytes) -> None:
            self.value = value
            self.disposed = False

        def __enter__(self) -> bytes:
            if self.disposed:
                raise RuntimeError("already disposed")
            return self.value

        def __exit__(self, *exc) -> bool:
            return False

        def dispose(self) -> None:
            self.disposed = True
            self.value = b""

    def test_a_prepared_request_refuses_an_authorization_header(self):
        with self.assertRaises(AuthorizationHeaderRefused):
            PreparedRequest(
                method="GET",
                url="https://www.googleapis.com/x",
                headers={"Authorization": "Bearer secret"},
                credential_ref="cred1",
            )

    def test_the_refusal_is_case_insensitive(self):
        for header in ("authorization", "AUTHORIZATION", "Proxy-Authorization", "Cookie"):
            with self.subTest(header=header):
                with self.assertRaises(AuthorizationHeaderRefused):
                    PreparedRequest(
                        method="GET",
                        url="https://www.googleapis.com/x",
                        headers={header: "value"},
                        credential_ref="cred1",
                    )

    def test_every_secret_header_is_covered(self):
        self.assertIn("authorization", SECRET_HEADERS)
        self.assertIn("cookie", SECRET_HEADERS)

    def test_the_connectors_package_never_imports_the_vault(self):
        from pathlib import Path

        from backend.boundaries import imported_names

        root = Path(__file__).resolve().parents[1] / "backend" / "connectors"
        for path in root.rglob("*.py"):
            for _, name in imported_names(path):
                with self.subTest(module=path.name, imported=name):
                    self.assertFalse(name.startswith("backend.vault"))

    def test_authorization_is_borrowed_and_disposed(self):
        request = PreparedRequest(
            method="GET",
            url="https://www.googleapis.com/x",
            headers={"Accept": "application/json"},
            credential_ref="cred1",
        )
        handle = self.FakeBorrow(b"token-value")
        with authorized(request, lambda ref: handle) as headers:
            self.assertEqual(headers["Authorization"], "Bearer token-value")
            self.assertEqual(headers["Accept"], "application/json")
            self.assertFalse(handle.disposed)
        self.assertTrue(handle.disposed)

    def test_the_secret_is_disposed_even_when_the_body_raises(self):
        request = PreparedRequest(
            method="GET",
            url="https://www.googleapis.com/x",
            headers={},
            credential_ref="cred1",
        )
        handle = self.FakeBorrow(b"token-value")
        with self.assertRaises(ZeroDivisionError):
            with authorized(request, lambda ref: handle):
                raise ZeroDivisionError("boom")
        self.assertTrue(handle.disposed)

    def test_the_request_that_survives_the_with_has_no_credential(self):
        request = PreparedRequest(
            method="GET",
            url="https://www.googleapis.com/x",
            headers={},
            credential_ref="cred1",
        )
        handle = self.FakeBorrow(b"token-value")
        with authorized(request, lambda ref: handle):
            pass
        self.assertNotIn("Authorization", request.headers)
        self.assertNotIn("token-value", repr(request))

    def test_a_connector_request_is_https(self):
        with self.assertRaises(ConnectorRefused):
            PreparedRequest(
                method="GET", url="http://www.googleapis.com/x", headers={}, credential_ref="c"
            )

    def test_the_only_allowed_host_passes_egress_and_others_do_not(self):
        self.assertEqual(EGRESS_ALLOWLIST, ("www.googleapis.com",))
        target = egress_check("https://www.googleapis.com/calendar/v3", allowlist=EGRESS_ALLOWLIST)
        self.assertEqual(target.host, "www.googleapis.com")
        with self.assertRaises(EgressRefused):
            egress_check("https://evil.example.com/x", allowlist=EGRESS_ALLOWLIST)


class ConnectionStateTests(unittest.TestCase):
    def test_a_fetch_401_does_not_clear_the_grant(self):
        # AGENTS.md records this from the Whoop client: clearing the grant on a
        # data-fetch 401 disconnected the user for a transient failure.
        after = on_fetch_unauthorized(connection())
        self.assertIs(after.state, ConnectionState.NEEDS_REFRESH)
        self.assertIsNot(after.state, ConnectionState.NEEDS_REAUTH)

    def test_a_successful_refresh_returns_to_connected_and_clears_the_count(self):
        stale = replace(connection(), state=ConnectionState.NEEDS_REFRESH, failed_refreshes=2)
        after = on_refresh_succeeded(stale)
        self.assertIs(after.state, ConnectionState.CONNECTED)
        self.assertEqual(after.failed_refreshes, 0)

    def test_repeated_refresh_failure_eventually_asks_for_reauth(self):
        current = connection()
        for attempt in range(1, MAX_REFRESH_ATTEMPTS):
            current = on_refresh_failed(current)
            self.assertIs(current.state, ConnectionState.NEEDS_REFRESH)
            self.assertEqual(current.failed_refreshes, attempt)
        current = on_refresh_failed(current)
        self.assertIs(current.state, ConnectionState.NEEDS_REAUTH)

    def test_only_an_explicit_revocation_reaches_reauth_in_one_step(self):
        self.assertIs(on_grant_revoked(connection()).state, ConnectionState.NEEDS_REAUTH)

    def test_revocation_does_not_delete_anything(self):
        before = connection()
        after = on_grant_revoked(before)
        self.assertEqual(after.credential_ref, before.credential_ref)
        self.assertEqual(after.scopes, before.scopes)
        self.assertEqual(after.features, before.features)

    def test_a_connection_that_cannot_fetch_refuses_to_build_a_request(self):
        for state in (
            ConnectionState.NEEDS_REFRESH,
            ConnectionState.NEEDS_REAUTH,
            ConnectionState.DISCONNECTED,
        ):
            with self.subTest(state=state):
                with self.assertRaises(ConnectorRefused):
                    list_calendars_request(replace(connection(), state=state))

    def test_reauthorization_checks_what_was_granted_not_what_was_asked(self):
        revoked = on_grant_revoked(connection())
        partial = READ_SCOPES[:2]
        with self.assertRaises(ScopeRefused):
            reauthorize(revoked, granted_scopes=partial, credential_ref="cred2")
        restored = reauthorize(revoked, granted_scopes=READ_SCOPES, credential_ref="cred2")
        self.assertIs(restored.state, ConnectionState.CONNECTED)
        self.assertEqual(restored.credential_ref, "cred2")

    def test_a_disconnected_connection_is_reconnected_not_reauthorized(self):
        with self.assertRaises(ConnectorRefused):
            reauthorize(disconnect(connection()), granted_scopes=READ_SCOPES, credential_ref="c2")

    def test_a_connection_must_say_what_it_is_for(self):
        with self.assertRaises(ConnectorRefused):
            connection(features=())


class WebhookCannotCarryContentTests(unittest.TestCase):
    CONTENT_FIELDS = {"payload", "body", "event", "events", "items", "data", "content", "resource"}

    def test_a_notification_has_no_field_an_event_could_live_in(self):
        names = {item.name for item in fields(hooks.Notification)}
        self.assertEqual(names & self.CONTENT_FIELDS, set())

    def test_the_only_output_of_a_valid_notification_is_an_instruction_to_fetch(self):
        names = {item.name for item in fields(hooks.FetchRequired)}
        self.assertEqual(names & self.CONTENT_FIELDS, set())
        self.assertEqual(names, {"user_id", "connection_id", "resource_id", "reason"})


def subscription(**kwargs) -> hooks.Subscription:
    base = {
        "channel_id": "chan1",
        "user_id": "u1",
        "connection_id": "conn1",
        "resource_id": "res1",
        "token_ref": "vault://tok",
        "created_at": NOW,
        "expires_at": NOW + timedelta(days=7),
    }
    base.update(kwargs)
    return hooks.Subscription(**base)


def notification(**kwargs) -> hooks.Notification:
    base = {
        "channel_id": "chan1",
        "resource_id": "res1",
        "state": hooks.ResourceState.EXISTS,
        "message_number": 1,
        "token": "secret-token",
    }
    base.update(kwargs)
    return hooks.Notification(**base)


class WebhookValidationTests(unittest.TestCase):
    def test_a_valid_notification_produces_a_fetch(self):
        advanced, fetch = hooks.handle(
            notification(), subscription(), expected_token="secret-token", now=NOW
        )
        self.assertEqual(advanced.last_message_number, 1)
        self.assertEqual(fetch.resource_id, "res1")

    def test_an_unknown_channel_is_refused(self):
        with self.assertRaises(hooks.WebhookRefused):
            hooks.validate(
                notification(channel_id="other"), subscription(),
                expected_token="secret-token", now=NOW,
            )

    def test_a_channel_watching_a_different_resource_is_refused(self):
        with self.assertRaises(hooks.WebhookRefused):
            hooks.validate(
                notification(resource_id="somebody-elses"), subscription(),
                expected_token="secret-token", now=NOW,
            )

    def test_a_wrong_token_is_refused(self):
        with self.assertRaises(hooks.WebhookRefused):
            hooks.validate(
                notification(token="wrong"), subscription(),
                expected_token="secret-token", now=NOW,
            )

    def test_the_token_is_compared_in_constant_time(self):
        # Asserting `compare_digest` appears in the source passed vacuously:
        # the docstring says the words. So the call itself is observed instead.
        import hmac as hmac_module
        from unittest.mock import patch

        with patch.object(
            hmac_module, "compare_digest", wraps=hmac_module.compare_digest
        ) as compare:
            hooks.validate(
                notification(), subscription(), expected_token="secret-token", now=NOW
            )
        compare.assert_called_once_with("secret-token", "secret-token")

    def test_a_wrong_token_is_still_refused_through_the_constant_time_path(self):
        import hmac as hmac_module
        from unittest.mock import patch

        with patch.object(
            hmac_module, "compare_digest", wraps=hmac_module.compare_digest
        ) as compare:
            with self.assertRaises(hooks.WebhookRefused):
                hooks.validate(
                    notification(token="wrong"), subscription(),
                    expected_token="secret-token", now=NOW,
                )
        compare.assert_called_once()

    def test_a_notification_on_an_expired_channel_is_refused(self):
        with self.assertRaises(hooks.WebhookRefused):
            hooks.validate(
                notification(), subscription(),
                expected_token="secret-token", now=NOW + timedelta(days=8),
            )

    def test_a_replayed_message_number_is_refused(self):
        current = subscription(last_message_number=5)
        for number in (1, 5):
            with self.subTest(number=number):
                with self.assertRaises(hooks.WebhookRefused):
                    hooks.validate(
                        notification(message_number=number), current,
                        expected_token="secret-token", now=NOW,
                    )

    def test_the_sync_handshake_advances_the_number_but_fetches_nothing(self):
        advanced, fetch = hooks.handle(
            notification(state=hooks.ResourceState.SYNC),
            subscription(),
            expected_token="secret-token",
            now=NOW,
        )
        self.assertIsNone(fetch)
        self.assertEqual(advanced.last_message_number, 1)
        # And the handshake cannot then be replayed.
        with self.assertRaises(hooks.WebhookRefused):
            hooks.validate(
                notification(state=hooks.ResourceState.SYNC),
                advanced,
                expected_token="secret-token",
                now=NOW,
            )

    def test_a_naive_now_is_refused_rather_than_raising_a_type_error(self):
        # `backend/connectors/sync.py` already refuses a naive `now`; this
        # module compared one straight against normalised aware values and
        # produced a raw TypeError from inside a validator. Two modules in one
        # package disagreeing at the aware/naive boundary is how the careful one
        # stops being trusted.
        naive = datetime(2026, 8, 25, 12)
        with self.assertRaises(hooks.WebhookRefused):
            hooks.validate(
                notification(), subscription(), expected_token="secret-token", now=naive
            )
        with self.assertRaises(hooks.WebhookRefused):
            hooks.handle(
                notification(), subscription(), expected_token="secret-token", now=naive
            )
        with self.assertRaises(hooks.WebhookRefused):
            hooks.renew(
                subscription(), now=naive, new_channel_id="c2", new_token_ref="t2"
            )

    def test_a_channel_may_not_outlive_the_providers_maximum(self):
        with self.assertRaises(hooks.WebhookRefused):
            subscription(expires_at=NOW + hooks.MAX_CHANNEL_LIFETIME + timedelta(days=1))

    def test_a_message_number_starts_at_one(self):
        with self.assertRaises(hooks.WebhookRefused):
            notification(message_number=0)


class SubscriptionRenewalTests(unittest.TestCase):
    def test_renewing_early_is_refused(self):
        with self.assertRaises(hooks.WebhookRefused):
            hooks.renew(subscription(), now=NOW, new_channel_id="c2", new_token_ref="t2")

    def test_a_live_channel_is_extended_without_forcing_reconciliation(self):
        current = subscription()
        renewal = hooks.renew(
            current,
            now=current.expires_at - timedelta(hours=2),
            new_channel_id="chan2",
            new_token_ref="vault://tok2",
        )
        self.assertFalse(renewal.recreated)
        self.assertFalse(renewal.reconciliation_required)
        self.assertEqual(renewal.subscription.channel_id, "chan2")
        self.assertEqual(renewal.subscription.last_message_number, 0)

    def test_an_expired_channel_is_recreated_and_forces_reconciliation(self):
        current = subscription()
        renewal = hooks.renew(
            current,
            now=current.expires_at + timedelta(hours=1),
            new_channel_id="chan2",
            new_token_ref="vault://tok2",
        )
        self.assertTrue(renewal.recreated)
        self.assertTrue(renewal.reconciliation_required)

    def test_needs_renewal_opens_a_day_before_expiry(self):
        current = subscription()
        self.assertFalse(current.needs_renewal(current.expires_at - timedelta(days=2)))
        self.assertTrue(current.needs_renewal(current.expires_at - timedelta(hours=1)))


def record(record_id: str, etag: str = "e1", deleted: bool = False) -> sync.RemoteRecord:
    return sync.RemoteRecord(record_id=record_id, etag=etag, updated_at=NOW, deleted=deleted)


class IncrementalAbsenceIsNotDeletionTests(unittest.TestCase):
    def setUp(self):
        self.state = sync.SyncState(
            user_id="u1", connection_id="conn1", resource="events", sync_token="tok1"
        )
        self.cache = {"a": record("a"), "b": record("b")}

    def test_an_event_absent_from_an_incremental_page_survives(self):
        result = sync.apply_incremental(
            self.state, self.cache, [record("c")], next_sync_token="tok2"
        )
        self.assertEqual(sorted(result.records), ["a", "b", "c"])
        self.assertEqual(result.removed, ())
        self.assertEqual(result.state.sync_token, "tok2")

    def test_only_an_explicit_deletion_removes_during_an_incremental_sync(self):
        result = sync.apply_incremental(
            self.state, self.cache, [record("a", deleted=True)], next_sync_token="tok2"
        )
        self.assertEqual(sorted(result.records), ["b"])
        self.assertEqual(result.removed, ("a",))

    def test_an_incremental_sync_without_a_token_is_refused(self):
        with self.assertRaises(sync.SyncRefused):
            sync.apply_incremental(
                replace(self.state, sync_token=None),
                self.cache,
                [record("c")],
                next_sync_token="tok2",
            )

    def test_absence_from_a_full_listing_is_deletion(self):
        result = sync.reconcile(self.state, self.cache, [record("a")], now=NOW)
        self.assertEqual(sorted(result.records), ["a"])
        self.assertEqual(result.removed, ("b",))
        self.assertEqual(result.state.last_full_listing_at, NOW)

    def test_a_delta_page_handed_to_reconcile_is_refused(self):
        with self.assertRaises(sync.SyncRefused):
            sync.reconcile(self.state, self.cache, [record("a", deleted=True)], now=NOW)

    def test_a_rejected_sync_token_is_cleared_rather_than_retried_forever(self):
        result = sync.on_sync_token_rejected(self.state)
        self.assertIs(result.outcome, sync.SyncOutcome.FULL_RESYNC_REQUIRED)
        self.assertIsNone(result.state.sync_token)

    def test_drift_is_reported_on_etag_not_on_payload(self):
        remote = {"a": record("a", etag="e2"), "c": record("c")}
        report = sync.drift(self.cache, remote)
        self.assertEqual(report["missing"], ("c",))
        self.assertEqual(report["extra"], ("b",))
        self.assertEqual(report["stale"], ("a",))


class ProviderShapeTests(unittest.TestCase):
    def test_an_all_day_events_exclusive_end_becomes_inclusive(self):
        # Google sends end.date one day past the last day. Stored verbatim it
        # makes every all-day event a day longer than it is.
        event = event_from_provider(
            {
                "id": "e1", "etag": "x", "summary": "Conference",
                "start": {"date": "2026-08-26"}, "end": {"date": "2026-08-27"},
            },
            calendar_id="cal1",
            calendar_timezone="America/New_York",
        )
        self.assertEqual(event.all_day_start, date(2026, 8, 26))
        self.assertEqual(event.all_day_end, date(2026, 8, 26))

    def test_an_all_day_event_spans_its_calendars_zone_not_utc(self):
        event = event_from_provider(
            {
                "id": "e1", "etag": "x", "summary": "Conference",
                "start": {"date": "2026-08-26"}, "end": {"date": "2026-08-27"},
            },
            calendar_id="cal1",
            calendar_timezone="America/New_York",
        )
        start, end = event.span()
        self.assertEqual(start, datetime(2026, 8, 26, 4, tzinfo=timezone.utc))
        self.assertEqual(end, datetime(2026, 8, 27, 4, tzinfo=timezone.utc))

    def test_an_unknown_transparency_becomes_unknown_and_still_blocks(self):
        event = event_from_provider(
            {
                "id": "e1", "etag": "x", "summary": "?",
                "start": {"dateTime": "2026-08-26T10:00:00+00:00"},
                "end": {"dateTime": "2026-08-26T11:00:00+00:00"},
                "transparency": "something-new",
            },
            calendar_id="cal1",
            calendar_timezone="UTC",
        )
        self.assertIs(event.transparency, Transparency.UNKNOWN)
        self.assertTrue(event.blocks_time())

    def test_the_users_own_response_is_read_from_the_self_attendee(self):
        event = event_from_provider(
            {
                "id": "e1", "etag": "x", "summary": "Standup",
                "start": {"dateTime": "2026-08-26T10:00:00+00:00"},
                "end": {"dateTime": "2026-08-26T11:00:00+00:00"},
                "transparency": "opaque",
                "attendees": [
                    {"email": "other@example.com", "responseStatus": "accepted"},
                    {"email": "me@example.com", "self": True, "responseStatus": "declined"},
                ],
            },
            calendar_id="cal1",
            calendar_timezone="UTC",
        )
        self.assertIs(event.response, Response.DECLINED)
        self.assertFalse(event.blocks_time())

    def test_a_provider_event_with_no_id_is_refused(self):
        with self.assertRaises(CalendarRefused):
            event_from_provider(
                {"summary": "x", "start": {"date": "2026-08-26"}, "end": {"date": "2026-08-27"}},
                calendar_id="cal1",
                calendar_timezone="UTC",
            )

    def test_a_cancelled_event_becomes_a_deletion_for_the_sync_layer(self):
        cancelled = timed("e1", 10, 11, status=EventStatus.CANCELLED)
        self.assertTrue(record_from_event(cancelled, updated_at=NOW).deleted)
        self.assertFalse(record_from_event(timed("e2", 10, 11), updated_at=NOW).deleted)


class RequestBuildingTests(unittest.TestCase):
    def test_a_sync_token_and_a_time_window_cannot_be_asked_for_together(self):
        with self.assertRaises(ConnectorRefused):
            list_events_request(
                connection(), "cal1", sync_token="tok", time_min=NOW
            )

    def test_an_incremental_request_carries_the_token(self):
        request = list_events_request(connection(), "cal1", sync_token="tok")
        self.assertIn("syncToken=tok", request.url)
        self.assertEqual(request.credential_ref, "cred1")

    def test_a_windowed_request_carries_utc_instants(self):
        request = list_events_request(
            connection(), "cal1", time_min=datetime(2026, 8, 26, tzinfo=timezone.utc)
        )
        self.assertIn("timeMin=2026-08-26T00:00:00Z", request.url)

    def test_a_naive_window_is_refused(self):
        with self.assertRaises(ConnectorRefused):
            list_events_request(connection(), "cal1", time_min=datetime(2026, 8, 26))

    def test_a_connection_without_calendar_read_cannot_build_a_calendar_request(self):
        gmail_only = connection(
            features=(Feature.GMAIL_READ,), scopes=for_features(Feature.GMAIL_READ)
        )
        with self.assertRaises(ConnectorRefused):
            list_calendars_request(gmail_only)

    def test_a_calendar_reports_whether_phase_25_could_write_there(self):
        summary = CalendarSummary(
            calendar_id="cal1", summary="Personal", primary=True,
            timezone_name="America/New_York", access_role="reader",
        )
        self.assertFalse(summary.writable)
        self.assertTrue(replace(summary, access_role="owner").writable)

    def test_a_calendar_without_a_timezone_is_refused(self):
        with self.assertRaises(CalendarRefused):
            CalendarSummary(
                calendar_id="cal1", summary="Personal", primary=True,
                timezone_name="", access_role="owner",
            )


class AvailabilityTests(unittest.TestCase):
    def window(self, start_hour: int = 9, end_hour: int = 17) -> avail.Interval:
        return avail.Interval(
            start=datetime(2026, 8, 26, start_hour, tzinfo=timezone.utc),
            end=datetime(2026, 8, 26, end_hour, tzinfo=timezone.utc),
        )

    def test_overlapping_events_merge_into_one_busy_block_naming_both(self):
        busy = avail.busy_intervals([timed("a", 10, 11), timed("b", 10, 12)])
        self.assertEqual(len(busy), 1)
        self.assertEqual(busy[0].causes, ("a", "b"))
        self.assertEqual(busy[0].interval.duration, timedelta(hours=2))

    def test_touching_events_merge_without_leaving_a_zero_length_gap(self):
        busy = avail.busy_intervals([timed("a", 10, 11), timed("b", 11, 12)])
        self.assertEqual(len(busy), 1)

    def test_a_declined_event_frees_the_time(self):
        self.assertEqual(avail.busy_intervals([timed("a", 10, 11, response=Response.DECLINED)]), ())

    def test_a_transparent_event_frees_the_time(self):
        self.assertEqual(
            avail.busy_intervals([timed("a", 10, 11, transparency=Transparency.TRANSPARENT)]), ()
        )

    def test_a_cancelled_event_frees_the_time(self):
        self.assertEqual(
            avail.busy_intervals([timed("a", 10, 11, status=EventStatus.CANCELLED)]), ()
        )

    def test_an_event_of_unknown_transparency_blocks(self):
        self.assertEqual(
            len(avail.busy_intervals([timed("a", 10, 11, transparency=Transparency.UNKNOWN)])), 1
        )

    def test_free_slots_are_the_gaps(self):
        slots = avail.free_slots(self.window(), [timed("a", 10, 11), timed("b", 14, 15)])
        self.assertEqual(
            [(slot.start.hour, slot.end.hour) for slot in slots],
            [(9, 10), (11, 14), (15, 17)],
        )

    def test_a_gap_shorter_than_the_minimum_is_not_offered(self):
        slots = avail.free_slots(
            self.window(), [timed("a", 9, 10), timed("b", 10, 17)], minimum=timedelta(minutes=15)
        )
        self.assertEqual(slots, ())

    def test_an_event_starting_before_the_window_still_blocks_inside_it(self):
        slots = avail.free_slots(self.window(), [timed("a", 7, 10)])
        self.assertEqual([(slot.start.hour, slot.end.hour) for slot in slots], [(10, 17)])

    def test_an_event_entirely_outside_the_window_does_not_shrink_it(self):
        slots = avail.free_slots(self.window(), [timed("a", 19, 20)])
        self.assertEqual([(slot.start.hour, slot.end.hour) for slot in slots], [(9, 17)])

    def test_a_fully_booked_window_offers_nothing(self):
        self.assertEqual(avail.free_slots(self.window(), [timed("a", 8, 18)]), ())

    def test_is_free_answers_the_whole_window(self):
        self.assertTrue(avail.is_free(self.window(), [timed("a", 19, 20)]))
        self.assertFalse(avail.is_free(self.window(), [timed("a", 10, 11)]))

    def test_conflicts_name_the_events_so_a_refusal_can_be_explained(self):
        candidate = avail.Interval(
            start=datetime(2026, 8, 26, 10, 30, tzinfo=timezone.utc),
            end=datetime(2026, 8, 26, 11, 30, tzinfo=timezone.utc),
        )
        hits = avail.conflicts(candidate, [timed("a", 10, 11), timed("b", 14, 15)])
        self.assertEqual([event.event_id for event in hits], ["a"])

    def test_an_all_day_transparent_event_does_not_eat_the_day(self):
        birthday = Event(
            event_id="bd", calendar_id="cal1", summary="Birthday",
            all_day_start=date(2026, 8, 26), all_day_end=date(2026, 8, 26),
            timezone_name="UTC", transparency=Transparency.TRANSPARENT,
        )
        self.assertEqual(
            [(slot.start.hour, slot.end.hour) for slot in avail.free_slots(self.window(), [birthday])],
            [(9, 17)],
        )

    def test_an_all_day_event_without_its_calendars_zone_is_refused(self):
        # No test covered this and the mutation survived. "All day on the 26th"
        # is a different eight hours of a person's life in every zone.
        with self.assertRaises(CalendarRefused):
            Event(
                event_id="bd", calendar_id="cal1", summary="Birthday",
                all_day_start=date(2026, 8, 26), all_day_end=date(2026, 8, 26),
            )

    def test_an_interval_must_end_after_it_starts(self):
        moment = datetime(2026, 8, 26, 10, tzinfo=timezone.utc)
        with self.assertRaises(CalendarRefused):
            avail.Interval(start=moment, end=moment)


class TenNamedCapabilitiesTests(unittest.TestCase):
    """The manifest lists ten. Each has a callable, and this names them."""

    def test_all_ten_exist(self):
        capabilities = {
            "calendar listing": list_calendars_request,
            "event reading": event_from_provider,
            "availability": avail.free_slots,
            "incremental sync": sync.apply_incremental,
            "webhook notification handling": hooks.handle,
            "webhook validation": hooks.validate,
            "subscription renewal": hooks.renew,
            "reauthorization": reauthorize,
            "token revocation handling": on_grant_revoked,
            "reconciliation": sync.reconcile,
        }
        self.assertEqual(len(capabilities), 10)
        for name, function in capabilities.items():
            with self.subTest(capability=name):
                self.assertTrue(callable(function))


class ModuleBoundaryTests(unittest.TestCase):
    def test_the_declared_graph_still_holds(self):
        from backend.boundaries import all_errors
        from backend.modules import MODULES

        self.assertEqual(all_errors(), [])
        self.assertEqual(MODULES["calendar"].depends_on, ("connectors", "users"))
        self.assertEqual(MODULES["connectors"].depends_on, ("users", "policies"))


if __name__ == "__main__":
    unittest.main()
