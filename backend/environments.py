"""Three environments that cannot share anything.

The manifest asks for DEV, STAGING and PRODUCTION with separate databases,
credentials, OAuth apps, APNs environments and secrets, and for production
secrets never to be used locally. Those are rules, so they are functions that
raise -- not a table in a runbook that is true until somebody is in a hurry.

Nothing here holds a secret. Every field is a NAME: a database name, a secret
scope, a credential namespace. The values live in a managed secret store, and
the point of the scope is that a non-production runtime cannot reach into the
production one.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from types import MappingProxyType
from typing import Mapping


class Environment(str, Enum):
    DEV = "dev"
    STAGING = "staging"
    PRODUCTION = "production"


class ProductionSecretRefused(RuntimeError):
    """A non-production runtime tried to resolve a production-scoped secret.

    Its own type, and never caught internally. "Never use production secrets
    locally" is the kind of rule that gets violated by a well-meaning fallback,
    so there is nothing here that falls back.
    """


@dataclass(frozen=True, slots=True)
class EnvironmentConfig:
    environment: Environment
    database: str
    secret_scope: str
    credential_namespace: str
    oauth_app: str
    apns_environment: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "environment", Environment(self.environment))
        for field in ("database", "secret_scope", "credential_namespace", "oauth_app"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value:
                raise ValueError(f"{field} must be a non-empty name")
        if self.apns_environment not in {"sandbox", "production"}:
            raise ValueError("apns_environment must be sandbox or production")
        if (self.environment is Environment.PRODUCTION) != (self.apns_environment == "production"):
            # A staging build pointed at production APNs sends real pushes to
            # real phones from code nobody has released.
            raise ValueError(
                f"{self.environment.value} must not use the {self.apns_environment} APNs environment"
            )


CONFIGURATIONS: Mapping[Environment, EnvironmentConfig] = MappingProxyType(
    {
        Environment.DEV: EnvironmentConfig(
            environment=Environment.DEV,
            database="orion_dev",
            secret_scope="orion/dev",
            credential_namespace="orion.dev",
            oauth_app="orion-dev",
            apns_environment="sandbox",
        ),
        Environment.STAGING: EnvironmentConfig(
            environment=Environment.STAGING,
            database="orion_staging",
            secret_scope="orion/staging",
            credential_namespace="orion.staging",
            oauth_app="orion-staging",
            apns_environment="sandbox",
        ),
        Environment.PRODUCTION: EnvironmentConfig(
            environment=Environment.PRODUCTION,
            database="orion_production",
            secret_scope="orion/production",
            credential_namespace="orion.production",
            oauth_app="orion",
            apns_environment="production",
        ),
    }
)

#: The fields that must differ between every pair of environments. OAuth apps are
#: on this list because the manifest says "where appropriate" and sharing one
#: means a staging consent screen granting access to production data.
SEPARATED_FIELDS = ("database", "secret_scope", "credential_namespace", "oauth_app")


def separation_errors(configurations: Mapping[Environment, EnvironmentConfig] | None = None) -> list[str]:
    """Every field two environments share, which should be none of them."""

    registry = CONFIGURATIONS if configurations is None else configurations
    errors: list[str] = []
    for field in SEPARATED_FIELDS:
        seen: dict[str, Environment] = {}
        for environment, configuration in registry.items():
            value = getattr(configuration, field)
            if value in seen:
                errors.append(
                    f"{environment.value} and {seen[value].value} share {field} {value!r}"
                )
            seen[value] = environment
    missing = sorted({item.value for item in Environment} - {item.value for item in registry})
    errors.extend(f"no configuration for {name}" for name in missing)
    return errors


def config_for(environment: Environment | str) -> EnvironmentConfig:
    return CONFIGURATIONS[Environment(environment)]


def scope_of(reference: str) -> str:
    """The secret scope a reference belongs to, e.g. `orion/production`."""

    if not isinstance(reference, str) or reference.count("/") < 2:
        raise ValueError("a secret reference looks like <owner>/<environment>/<name>")
    owner, environment, _ = reference.split("/", 2)
    return f"{owner}/{environment}"


def resolve_secret_reference(reference: str, *, environment: Environment | str) -> str:
    """Check that this runtime may resolve this secret, and return the reference.

    Returns the reference rather than a value: resolving the value is the secret
    store's job, and Core-adjacent code that could return one would eventually be
    asked to log it.
    """

    running_in = Environment(environment)
    scope = scope_of(reference)
    if scope == CONFIGURATIONS[Environment.PRODUCTION].secret_scope and running_in is not Environment.PRODUCTION:
        raise ProductionSecretRefused(
            f"a {running_in.value} runtime may not resolve {reference}"
        )
    expected = CONFIGURATIONS[running_in].secret_scope
    if scope != expected:
        raise ProductionSecretRefused(
            f"a {running_in.value} runtime may only resolve {expected}/* secrets, not {reference}"
        )
    return reference
