# Things only you can do

Work that is blocked on you rather than on code — accounts, money, taste, or a
password I must not handle. Kept here so it is one list you can pick off when you
have time, instead of scattered through old chat.

Each item says what it unblocks, so you can judge whether it is worth an evening.

---

## 1. Pick the break ambience clips

**Why:** the synthesised rain/waves/wind sounded synthetic, because it is. Real
recordings are the fix and they are a taste decision — you will know in five
seconds whether a clip is right and I will not.

**What to do:** grab three loops — rain, waves, wind — and drop them in
`native/Orion/Resources/Ambience/` named `rain.m4a`, `waves.m4a`, `wind.m4a`.
Anything 30–90 seconds that loops without an obvious seam. I will wire the
loader, crossfade and settings around whatever is in that folder.

Sources worth a look, cleanest licence first:

| source | licence | note |
|---|---|---|
| [Selekt](https://selektaudio.com/sound-lab/textures/wind) | explicitly CC0 | safest if Orion is ever published |
| [BigSoundBank](https://bigsoundbank.com/search?q=ambient) | free + royalty-free worldwide | long clean recordings; attribution not addressed |
| [Pixabay](https://pixabay.com/sound-effects/search/cc0/) | no attribution needed | licence restricts redistributing files *as standalone files* — grey area for an app bundle |

**Unblocks:** ambience stops being a placeholder. Until then the break is silent
by default rather than sounding cheap.

---

## 2. Apple Developer Program — $99/year

**Why:** it is the single fix for the Keychain prompt storm. A Team ID makes
`keychain-access-groups` valid, which unlocks the data-protection Keychain, where
access is granted by entitlement rather than by per-item ACL — **zero prompts,
ever, for you and for anyone else**. Measured 2026-08-18: self-signed cannot do
this. Claiming the entitlement gets the process SIGKILLed; without it every call
returns `-34018`.

It is also required for notarization, without which nobody but you can run Orion
at all — Gatekeeper blocks it outright.

**What to do:** enrol at developer.apple.com/programs (Apple ID with 2FA; must be
legal age of majority). Then Xcode → Settings → Accounts → Manage Certificates →
**+** → Developer ID Application. Tell me the ten-character Team ID — that is all
I need, nothing secret.

**One-time cost when you do:** the signing identity changes, so macOS sees a new
app once. Re-grant mic/accessibility/speech, and the first launch reads your
existing secrets one last time before moving them. After that it never asks again.

**Unblocks:** no more Keychain dialogs; notarization; anyone else being able to
install Orion.

---

## 3. Link GitHub, so updates have somewhere to live

**Why:** the updater works end to end — proven against a local feed — but points
at a placeholder URL, so "Check for Updates" fails. It needs a real feed.

**What to do:**

```bash
brew install gh && gh auth login
```

I cannot run that second command for you — it is a browser sign-in to your
account. Afterwards tell me your GitHub username, what to call the repo, and
whether it should be public or private, and I will create it and cut the first
release.

**Unblocks:** updates that actually arrive, instead of you rebuilding by hand.

---

## 4. Back up the Sparkle signing key

**Why:** the EdDSA private key in your login Keychain is the only thing that can
sign an update Orion will accept. Lose it — dead disk, wiped Keychain — and no
future version can ever be installed by any copy of the app already out there.
There is no recovery path; that is the design.

**What to do:** export it once and put it somewhere that is not this Mac (a
password manager entry is ideal).

```bash
native/Orion/.build/artifacts/sparkle/Sparkle/bin/generate_keys -x ~/Desktop/orion-sparkle-key.txt
```

Then move that file off the machine and delete the local copy.

**Unblocks:** nothing today. Prevents a specific unrecoverable failure later.
