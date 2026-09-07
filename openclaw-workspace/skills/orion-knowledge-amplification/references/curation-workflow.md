# Curation workflow

## Vault target

Use the dedicated Orion Brain vault profile maintained by
`orion-obsidian-knowledge`. Do not infer or discover other personal vaults.

## Preferred note properties

```yaml
---
title: ""
note_type: concept
status: seed
source_type: official-docs-synthesis
sources: []
license_notes: ""
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
tags: []
---
```

Allowed status values: `seed`, `active`, `reviewed`, `stale`, `archived`.

## Curation checks

- Does the note answer a real Orion or user knowledge need?
- Is it more useful than a link alone?
- Are important claims traceable to primary or authoritative sources?
- Is the license known, or is use limited to attribution and original
  paraphrase?
- Is freshness visible for drift-prone material?
- Are facts, inference, and user conclusions distinguishable?
- Does the note link to a map, project, area, resource, or concept?
- Is retrieval possible without loading unrelated private context?
- Are authority, permissions, TaskGraph state, and executable instructions
  excluded?

## Source Register entry

Record publisher, exact URL or user-owned local path, access date, license
status, how the source was used, and any limitations. Never claim a license
that has not been verified.
