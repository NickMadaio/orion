// Domains the mail watcher treats specially (wave 14 fix, 2026-11-02). Pure lists and one matcher.
//
//   SCHOOL         his university: never muted as a whole ("not important" on the registrar must not mute every professor)
//   FREEMAIL       shared mailbox providers: a domain rule here would mute or boost half the world
//   KNOWN_SERVICE  big sign-in and banking providers: only their security codes may skip the 30-minute spacing. A stranger's
//                  "verification code" waits like any other mail (a phishing mail is exactly a stranger's urgent code).
// plugin/orion-control/src/mail-flow.ts keeps a copy of SCHOOL + FREEMAIL (the plugin cannot import scripts); change both together.

export const DEFAULT_SCHOOL_DOMAINS = Object.freeze(["northeastern.edu", "nulondon.ac.uk"]);
export const FREEMAIL_DOMAINS = Object.freeze(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "live.co.uk", "msn.com",
  "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.co.uk", "mail.com", "zoho.com", "fastmail.com"]);
export const PROTECTED_DOMAINS = Object.freeze([...DEFAULT_SCHOOL_DOMAINS, ...FREEMAIL_DOMAINS]);
export const KNOWN_SERVICE_DOMAINS = Object.freeze(["google.com", "apple.com", "microsoft.com", "microsoftonline.com", "github.com", "amazon.com", "amazon.co.uk",
  "paypal.com", "paypal.co.uk", "barclays.co.uk", "hsbc.co.uk", "lloydsbank.co.uk", "natwest.com", "santander.co.uk", "monzo.com", "revolut.com", "starlingbank.com",
  "chase.com", "bankofamerica.com", "wellsfargo.com", "capitalone.com", "venmo.com", "discord.com", "openai.com", "anthropic.com", "duo.com", "okta.com"]);

/** The domain is one of `list` or a subdomain of one. */
export const onDomain = (domain, list) => { const d = String(domain ?? "").toLowerCase(); return !!d && list.some((x) => d === x || d.endsWith(`.${x}`)); };
