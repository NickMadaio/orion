/*
 Tests for the Gmail summarising/cleaning layer used by both mail wrappers.

 The bug these lock down was not a crash. Both wrappers printed whole threads
 verbatim, so one `in:inbox` search cost about fifteen thousand characters of
 Orion's context — mostly unsubscribe blocks, privacy policies and
 quoted-printable artefacts — against a 20,000-character instruction budget.
 Reading his mail evicted his instructions.

 Loaded through a computed URL for the same reason as the typedstream tests:
 the module lives in scripts/lib and must stay out of the plugin's tsc build.
*/
import { describe, expect, it } from "vitest";
const MODULE_URL = new URL("../../../scripts/lib/gmail-format.mjs", import.meta.url).href;
const load = async () => (await import(MODULE_URL));
describe("quoted-printable", () => {
    it("decodes multi-byte sequences as one character, not three", async () => {
        const { decodeQuotedPrintable } = await load();
        // The artefacts Nick actually saw in wrapper output.
        expect(decodeQuotedPrintable("it=E2=80=99s")).toBe("it’s");
        expect(decodeQuotedPrintable("a=C2=A0b")).toBe("a b");
        expect(decodeQuotedPrintable("caf=C3=A9")).toBe("café");
    });
    it("rejoins soft line breaks before decoding across them", async () => {
        const { decodeQuotedPrintable } = await load();
        expect(decodeQuotedPrintable("it=E2=80=\r\n=99s")).toBe("it’s");
    });
    it("leaves text that only looks like an escape alone", async () => {
        const { decodeQuotedPrintable } = await load();
        expect(decodeQuotedPrintable("the total =50 units")).toBe("the total =50 units");
        expect(decodeQuotedPrintable("no escapes here")).toBe("no escapes here");
    });
});
describe("boilerplate stripping", () => {
    it("cuts the footer off and keeps the message", async () => {
        const { stripBoilerplate } = await load();
        const message = "Hi Nick, the class is on Monday the 17th at 9am and you should bring your own whistle plus the signed waiver form we discussed last week on the phone. Let me know if that works for you.";
        const footer = " Unsubscribe: [url removed] Privacy Policy: [url removed] © 2026 Pool Management. All rights reserved. This email was sent to nmadaio08@gmail.com";
        const cleaned = stripBoilerplate(message + footer);
        expect(cleaned).toBe(message.trim());
        expect(cleaned).not.toMatch(/unsubscribe|privacy policy|all rights reserved/i);
    });
    it("does not cut a short message that happens to say the word", async () => {
        const { stripBoilerplate } = await load();
        // Below the offset floor: cutting here would leave nothing at all.
        const short = "Can you unsubscribe me from that list?";
        expect(stripBoilerplate(short)).toBe(short);
    });
    it("removes sanitiser residue and preview padding", async () => {
        const { stripBoilerplate } = await load();
        // `--sanitize-content` leaves these behind where links were.
        expect(stripBoilerplate("Apply now: [url removed] [url removed] done")).toBe("Apply now: done");
        // Marketing senders pad the preview with invisible characters.
        const padded = "Grab your FREE BOX today..." + "͏ ".repeat(80);
        expect(stripBoilerplate(padded)).toBe("Grab your FREE BOX today...");
        expect(stripBoilerplate("a​b­c﻿d")).toBe("abcd");
    });
    it("decodes before it strips", async () => {
        const { stripBoilerplate } = await load();
        const body = "Hey, here=E2=80=99s the plan for the weekend and I think it should work well for everyone involved, let me know what you reckon about the timing. Unsubscribe here";
        const cleaned = stripBoilerplate(body);
        expect(cleaned).toContain("here’s");
        expect(cleaned).not.toContain("=E2=80=99");
        expect(cleaned).not.toMatch(/unsubscribe/i);
    });
});
describe("summaries", () => {
    /** The shape gog returns from `gmail thread get`, trimmed to what is read. */
    const threadPayload = {
        thread: {
            id: "19ffdec5bfe33403",
            messages: [
                {
                    labelIds: ["UNREAD", "INBOX"],
                    snippet: "Hi Nick, your customer service experience could be a great match",
                    headers: {
                        date: "Fri, 14 Aug 2026 01:39:13 +0000",
                        from: "Indeed <donotreply@match.indeed.com>",
                        subject: "Retail Sales Associate @ Staples, Inc.",
                    },
                    body: "a".repeat(9000),
                },
            ],
        },
    };
    it("keeps who, what, when, a preview and the thread id — and nothing else", async () => {
        const { summarise } = await load();
        const summary = summarise(threadPayload);
        expect(summary.threadId).toBe("19ffdec5bfe33403");
        expect(summary.from).toBe("Indeed (donotreply@match.indeed.com)");
        expect(summary.subject).toBe("Retail Sales Associate @ Staples, Inc.");
        expect(summary.unread).toBe(true);
        expect(summary.snippet).toContain("customer service experience");
        // The 9,000-character body is the whole point: it must not be carried.
        expect(JSON.stringify(summary)).not.toContain("aaaa");
    });
    it("reads the flat search-result shape too", async () => {
        const { summarise } = await load();
        const summary = summarise({
            id: "abc123",
            date: "2026-08-13 18:02",
            from: "TacticalBox <support@tacticalbox.com>",
            subject: "$150 in Tactical Gear",
            labels: ["CATEGORY_PROMOTIONS", "INBOX"],
            messageCount: 1,
        });
        expect(summary.threadId).toBe("abc123");
        expect(summary.from).toBe("TacticalBox (support@tacticalbox.com)");
        expect(summary.date).toBe("2026-08-13 18:02");
        expect(summary.unread).toBe(false);
    });
    it("handles a bare address and a missing subject without inventing either", async () => {
        const { summarise } = await load();
        const summary = summarise({ id: "x", from: "plain@example.com" });
        expect(summary.from).toBe("plain@example.com");
        expect(summary.subject).toBe("(no subject)");
    });
    it("renders a search result small enough to keep", async () => {
        const { summarise, renderSummaries } = await load();
        const rendered = renderSummaries(Array.from({ length: 5 }, () => summarise(threadPayload)), { query: "in:inbox" });
        // Five results used to cost about 15,000 characters.
        expect(rendered.length).toBeLessThan(2500);
        expect(rendered).toContain("thread: 19ffdec5bfe33403");
        // It must say how to get the rest, or the default is a dead end.
        expect(rendered).toContain("--thread");
    });
    it("says so plainly when nothing matched", async () => {
        const { renderSummaries } = await load();
        expect(renderSummaries([], { query: "from:nobody" })).toBe('No mail matched "from:nobody".');
    });
});
describe("full bodies", () => {
    it("caps an enormous body instead of trailing off silently", async () => {
        const { capBody } = await load();
        const capped = capBody("x".repeat(5000));
        expect(capped.length).toBeLessThan(5000);
        expect(capped).toContain("[body truncated]");
        // A body under the cap is returned untouched.
        expect(capBody("short one")).toBe("short one");
    });
    it("returns a cleaned body when one is explicitly asked for", async () => {
        const { renderFull } = await load();
        const rendered = renderFull({
            thread: {
                id: "t1",
                messages: [
                    {
                        headers: { from: "Mom <mom@example.com>", subject: "Dinner", date: "Thu, 13 Aug 2026" },
                        body: "Are you coming over on Sunday? Let me know by Friday so I can plan the food properly and get to the shops in time. Unsubscribe: [url removed] Privacy Policy",
                    },
                ],
            },
        });
        expect(rendered).toContain("From:    Mom (mom@example.com)");
        expect(rendered).toContain("coming over on Sunday");
        expect(rendered).not.toMatch(/unsubscribe|privacy policy/i);
    });
    it("does not pretend an empty thread has content", async () => {
        const { renderFull } = await load();
        expect(renderFull({ thread: { id: "t", messages: [] } })).toBe("That thread has no readable messages.");
    });
});
