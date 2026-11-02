export function stepsAsToolResults(steps) {
    return steps.map((s) => {
        const what = `${s.action}${s.target ? ` ${s.target}` : ""}`.trim();
        const canonical = `computer ${what}`;
        if (s.action === "observe")
            return { canonical, stdout: `Screen read${s.note ? `: ${s.note}` : ""}`, exit: 0 };
        if (s.ok && s.verified)
            return { canonical, stdout: `Changed ${what} (confirmed on screen)`, exit: 0 };
        return { canonical, stdout: `Error: ${what} did not take effect${s.note ? ` (${s.note})` : ""}`, exit: 1 };
    });
}
