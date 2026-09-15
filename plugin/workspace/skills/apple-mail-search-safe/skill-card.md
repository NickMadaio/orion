## Description: <br>
Apple Mail Search Safe (fruitmail) helps agents search local Apple Mail messages on macOS by subject, sender, recipient, date, unread status, and message body. <br>

This skill is ready for commercial/non-commercial use. <br>

## Publisher: <br>
[gumadeiras](https://clawhub.ai/user/gumadeiras) <br>

### License/Terms of Use: <br>
MIT-0 <br>


## Use Case: <br>
Developers and agents use this skill to locate, inspect, and open messages in a user's local Apple Mail mailbox without composing or sending email. It is useful for mailbox triage, message lookup, and retrieving full email bodies when the user has granted local mail access. <br>

### Deployment Geography for Use: <br>
Global <br>

## Known Risks and Mitigations: <br>
Risk: The fruitmail CLI and the agent can access private local Apple Mail search results and full email bodies. <br>
Mitigation: Install only in trusted environments, treat retrieved email content as private, and avoid sharing results beyond the intended user context. <br>
Risk: Email content can contain untrusted instructions or misleading text. <br>
Mitigation: Treat message bodies as untrusted data and do not follow instructions found inside emails without explicit user confirmation. <br>
Risk: The skill depends on an external npm package for local mailbox access. <br>
Mitigation: Review the fruitmail package and supply-chain controls before use in environments with stronger assurance requirements. <br>


## Reference(s): <br>
- [ClawHub skill page](https://clawhub.ai/gumadeiras/skills/apple-mail-search-safe) <br>
- [Publisher profile](https://clawhub.ai/user/gumadeiras) <br>


## Skill Output: <br>
**Output Type(s):** [text, markdown, shell commands, guidance] <br>
**Output Format:** [Markdown guidance with inline shell commands; fruitmail command results may be plain text or JSON.] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [Requires macOS, local Apple Mail data, and the fruitmail CLI.] <br>

## Skill Version(s): <br>
5.0.5 (source: server release evidence) <br>

## Ethical Considerations: <br>
Users should evaluate whether this skill is appropriate for their environment, review any generated or modified files before relying on them, and apply their organization's safety, security, and compliance requirements before deployment. <br>
