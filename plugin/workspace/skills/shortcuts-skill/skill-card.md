## Description: <br>
Generate macOS/iOS Shortcuts by creating plist files. Use when asked to create shortcuts, automate workflows, build .shortcut files, or generate Shortcuts plists. Covers 1,155 actions (427 WF*Actions + 728 AppIntents), variable references, and control flow. <br>

This skill is ready for commercial/non-commercial use. <br>

## Publisher: <br>
[erik-agens](https://clawhub.ai/user/erik-agens) <br>

### License/Terms of Use: <br>


## Use Case: <br>
Developers and automation builders use this skill to generate Apple Shortcuts plist files for macOS and iOS workflows, including action wiring, variables, control flow, and signing guidance. <br>

### Deployment Geography for Use: <br>
Global <br>

## Known Risks and Mitigations: <br>
Risk: Generated shortcuts may include powerful actions such as deleting data, running shell or AppleScript, accessing photos/files/location/contacts/clipboard, sending messages, making network requests, changing system settings, or running other shortcuts. <br>
Mitigation: Inspect generated actions before importing or running the shortcut, and add confirmation or preview steps for destructive or sensitive automations. <br>
Risk: A generated shortcut plist may not behave as intended if action identifiers, parameter types, variable references, or control-flow grouping are incorrect. <br>
Mitigation: Review the generated plist structure against the included action, parameter, variable, and control-flow references before signing and importing it. <br>


## Reference(s): <br>
- [ClawHub skill page](https://clawhub.ai/erik-agens/skills/shortcuts-skill) <br>
- [Shortcut plist format](artifact/PLIST_FORMAT.md) <br>
- [Shortcuts actions reference](artifact/ACTIONS.md) <br>
- [AppIntents reference](artifact/APPINTENTS.md) <br>
- [Parameter types reference](artifact/PARAMETER_TYPES.md) <br>
- [Variable reference system](artifact/VARIABLES.md) <br>
- [Control flow patterns](artifact/CONTROL_FLOW.md) <br>
- [Content item filters reference](artifact/FILTERS.md) <br>
- [Complete working examples](artifact/EXAMPLES.md) <br>


## Skill Output: <br>
**Output Type(s):** [text, markdown, code, shell commands, configuration, guidance] <br>
**Output Format:** [Markdown guidance with XML plist snippets, shell commands, and shortcut file structure details] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [Generated shortcuts should be reviewed before import or execution and signed with the macOS shortcuts CLI before use.] <br>

## Skill Version(s): <br>
0.1.0 (source: server release metadata) <br>

## Ethical Considerations: <br>
Users should evaluate whether this skill is appropriate for their environment, review any generated or modified files before relying on them, and apply their organization's safety, security, and compliance requirements before deployment. <br>
