"""What a piece of context is about, and where it came from.

Nothing in ORION labelled context by domain before Phase 3, which meant the
manifest's central rule -- do not let health context reach an email task -- was
unenforceable rather than unenforced. You cannot write a rule about a property
nothing records.
"""

from __future__ import annotations

from enum import Enum


class Domain(str, Enum):
    """The manifest's twelve.

    CREDENTIALS is in the list but is not a domain context is built from. It
    exists so "never expose credentials" becomes something the type system can
    state instead of a sentence in a document -- see `policy.py`, where it is the
    one domain no allowance can admit.
    """

    GENERAL = "general"
    CONVERSATION = "conversation"
    CALENDAR = "calendar"
    EMAIL = "email"
    HEALTH = "health"
    COMPUTER = "computer"
    FILES = "files"
    PROJECTS = "projects"
    CONTACTS = "contacts"
    TRAVEL = "travel"
    SECURITY = "security"
    CREDENTIALS = "credentials"


class Provenance(str, Enum):
    """Where a piece of context came from, and how much it should be believed.

    Orthogonal to the plugin's three trust levels, not a replacement for them.
    Trust answers "may this authorize an action" and stays where it is. These
    answer "where did this come from", which is the question a context firewall
    actually needs -- and the manifest asks for both the origin and the
    confidence separately, which three levels cannot express.
    """

    USER_ASSERTED = "user_asserted"
    USER_CONFIRMED = "user_confirmed"
    SYSTEM_GENERATED = "system_generated"
    ORION_INFERRED = "orion_inferred"
    EXTERNAL_UNTRUSTED = "external_untrusted"
    DEVICE_OBSERVED = "device_observed"


#: Every source the manifest names as untrusted. Content arriving through any of
#: these is data, never instruction, no matter how it is phrased.
UNTRUSTED_SOURCES = frozenset(
    {
        "email",
        "webpage",
        "pdf",
        "document",
        "calendar_description",
        "message",
        "api_response",
        "screen_contents",
        "downloaded_file",
    }
)

#: Sources ORION itself produces, and what they mean.
KNOWN_SOURCES = {
    "user_turn": Provenance.USER_ASSERTED,
    "user_approval": Provenance.USER_CONFIRMED,
    "orion_state": Provenance.SYSTEM_GENERATED,
    "orion_memory": Provenance.SYSTEM_GENERATED,
    "orion_inference": Provenance.ORION_INFERRED,
    "sensor": Provenance.DEVICE_OBSERVED,
    "camera_presence": Provenance.DEVICE_OBSERVED,
    "system_status": Provenance.DEVICE_OBSERVED,
}


def classify(source: str) -> Provenance:
    """The provenance category for a named source.

    An unrecognised source is EXTERNAL_UNTRUSTED. That default is the whole
    point: a new integration that nobody remembered to classify must arrive as
    untrusted, because the alternative is that forgetting to think about a source
    silently grants it credibility.
    """

    if not isinstance(source, str) or not source:
        return Provenance.EXTERNAL_UNTRUSTED
    normalized = source.strip().lower()
    if normalized in UNTRUSTED_SOURCES:
        return Provenance.EXTERNAL_UNTRUSTED
    return KNOWN_SOURCES.get(normalized, Provenance.EXTERNAL_UNTRUSTED)


def is_authoritative(provenance: Provenance) -> bool:
    """Whether context from this origin may be acted on without corroboration.

    ORION_INFERRED is deliberately excluded. Orion concluding something is not
    the user saying it, and the difference is exactly where a confident assistant
    goes wrong.
    """

    return provenance in {
        Provenance.USER_ASSERTED,
        Provenance.USER_CONFIRMED,
        Provenance.SYSTEM_GENERATED,
        Provenance.DEVICE_OBSERVED,
    }
