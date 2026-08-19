/*
 Tests for the iMessage `attributedBody` decoder.

 The decoder lives in scripts/lib/imessage-typedstream.mjs because the thing
 that runs it is `scripts/orion-messages`, not the plugin. It is tested from
 here because this is where the suite is, and because the bug it fixes reached
 Nick through a plugin tool (`messages_recent`) -- so the guarantee belongs next
 to the rest of the guarantees about what that tool may say.

 The fixtures are not hand-written. Every `hex` below was produced by Foundation
 itself, by archiving an NSAttributedString with NSArchiver on this machine --
 the same call Messages makes -- so they are the real byte layout and not an
 approximation of it. The generator is reproduced in the comment at the bottom
 so the fixtures can be regenerated rather than trusted.

 The case this suite exists for is `SHORT_IMMUTABLE`. That is the exact shape
 that made Nick's inbox print

     21:56  me: NSObject
     21:56  Karlita: NSObject

 and there is an explicit test that the old algorithm returned `NSObject` for
 it, so nobody can reintroduce "longest printable run" and have the suite stay
 green.
*/
import { describe, expect, it } from "vitest";
/*
 Loaded through a computed URL on purpose.

 `tsc -p tsconfig.json` compiles src/ with rootDir semantics, and a static
 import of a .mjs two directories outside src/ would drag it into the build. The
 URL is opaque to the type checker and resolved by Node at run time, which is
 what both vitest and the real script do anyway.
*/
const MODULE_URL = new URL("../../../scripts/lib/imessage-typedstream.mjs", import.meta.url).href;
const loadDecoder = async () => (await import(MODULE_URL));
/** Archived by NSArchiver on macOS. See the note at the bottom of this file. */
const FIXTURES = {
    /*
     An immutable NSAttributedString with no attribute runs -- what a plain short
     reply looks like on the wire. The class chain is NSAttributedString ->
     NSObject -> NSString, so the longest ASCII run in the whole blob is the
     eight characters of `NSObject`, and the message itself is two. This is the
     blob behind the bug report.
    */
    SHORT_IMMUTABLE: {
        text: "ok",
        hex: "040B73747265616D747970656481E803840140848484124E5341747472696275746564537472696E67008484084E534F626A656374008592848484084E53537472696E67019484012B026F6B86840269490102928484840C4E5344696374696F6E6172790094840169008686",
    },
    SHORT_IMMUTABLE_2: {
        text: "yeah",
        hex: "040B73747265616D747970656481E803840140848484124E5341747472696275746564537472696E67008484084E534F626A656374008592848484084E53537472696E67019484012B047965616886840269490104928484840C4E5344696374696F6E6172790094840169008686",
    },
    /*
     A mutable string carrying an attribute run, which is what Messages writes
     once anything at all is attached to the text. The chain gains
     NSMutableAttributedString -- twenty-five characters -- so the old algorithm
     failed here too, just with a different class name.
    */
    SHORT_MUTABLE: {
        text: "haha",
        hex: "040B73747265616D747970656481E803840140848484194E534D757461626C6541747472696275746564537472696E67008484124E5341747472696275746564537472696E67008484084E534F626A6563740085928484840F4E534D757461626C65537472696E67018484084E53537472696E67019584012B046861686186840269490104928484840C4E5344696374696F6E617279009584016901928498981D5F5F6B494D4D657373616765506172744174747269627574654E616D658692848484084E534E756D626572008484074E5356616C7565009584012A849B9B00868686",
    },
    /** Multi-byte characters, which the old edge-trimming used to eat into. */
    EMOJI: {
        text: "Sounds good 👍",
        hex: "040B73747265616D747970656481E803840140848484194E534D757461626C6541747472696275746564537472696E67008484124E5341747472696275746564537472696E67008484084E534F626A6563740085928484840F4E534D757461626C65537472696E67018484084E53537472696E67019584012B10536F756E647320676F6F6420F09F918D8684026949010E928484840C4E5344696374696F6E617279009584016901928498981D5F5F6B494D4D657373616765506172744174747269627574654E616D658692848484084E534E756D626572008484074E5356616C7565009584012A849B9B00868686",
    },
    /** U+FFFC marks where an attachment sits inside the text. */
    WITH_ATTACHMENT: {
        text: "check this out",
        hex: "040B73747265616D747970656481E803840140848484124E5341747472696275746564537472696E67008484084E534F626A656374008592848484084E53537472696E67019484012B11EFBFBC636865636B2074686973206F75748684026949010F928484840C4E5344696374696F6E6172790094840169008686",
    },
    /*
     139 bytes of text, which is over the single-byte length limit, so the length
     is written `81 8B 00` -- the two-byte form. Any message longer than a
     sentence takes this path, so a decoder that only reads single-byte lengths
     truncates most real messages while passing every short test.
    */
    LONG_INT16_LENGTH: {
        text: "Can you grab milk, eggs, and bread on the way home? I think we're out of all three and I won't get back until late tonight, so it's on you.",
        hex: "040B73747265616D747970656481E803840140848484124E5341747472696275746564537472696E67008484084E534F626A656374008592848484084E53537472696E67019484012B818B0043616E20796F752067726162206D696C6B2C20656767732C20616E64206272656164206F6E207468652077617920686F6D653F2049207468696E6B207765277265206F7574206F6620616C6C20746872656520616E64204920776F6E277420676574206261636B20756E74696C206C61746520746F6E696768742C20736F2069742773206F6E20796F752E868402694901818B00928484840C4E5344696374696F6E6172790094840169008686",
    },
};
const blobOf = (hex) => Buffer.from(hex, "hex");
/*
 The algorithm that shipped, reproduced verbatim.

 Kept so the tests can assert what it actually did rather than describing it.
 If someone reaches for this approach again, the assertions below are the
 argument against it, in his own data.
*/
function longestPrintableRun(hex) {
    const raw = Buffer.from(hex, "hex").toString("utf8");
    const runs = raw.match(/[ -~ -￿]{4,}/g) ?? [];
    const best = runs
        .filter((r) => !/^(NSString|NSAttributedString|NSDictionary|NSNumber|streamtyped|__k)/.test(r))
        .sort((a, b) => b.length - a.length)[0];
    return (best ?? "")
        .replace(/^[�-¿]+|[�-¿]+$/g, "")
        .trim();
}
describe("attributedBody decoding", () => {
    it("reproduces the bug: the old algorithm returned NSObject for a short reply", () => {
        // Not a hypothetical. This is what `messages_recent` printed for nine of
        // twelve rows, and the reason a class name is now structurally impossible.
        expect(longestPrintableRun(FIXTURES.SHORT_IMMUTABLE.hex)).toBe("NSObject");
        expect(longestPrintableRun(FIXTURES.SHORT_IMMUTABLE_2.hex)).toBe("NSObject");
        expect(longestPrintableRun(FIXTURES.SHORT_MUTABLE.hex)).toBe("NSMutableAttributedString");
    });
    it("decodes the exact blob that used to yield NSObject", async () => {
        const { decodeAttributedBody } = await loadDecoder();
        const decoded = decodeAttributedBody(blobOf(FIXTURES.SHORT_IMMUTABLE.hex));
        expect(decoded).toEqual({ status: "text", text: "ok" });
    });
    it("decodes short replies of both archive shapes", async () => {
        const { decodeAttributedBody } = await loadDecoder();
        expect(decodeAttributedBody(blobOf(FIXTURES.SHORT_IMMUTABLE_2.hex)).text).toBe("yeah");
        expect(decodeAttributedBody(blobOf(FIXTURES.SHORT_MUTABLE.hex)).text).toBe("haha");
    });
    it("keeps multi-byte characters intact", async () => {
        const { decodeAttributedBody } = await loadDecoder();
        expect(decodeAttributedBody(blobOf(FIXTURES.EMOJI.hex)).text).toBe("Sounds good 👍");
    });
    it("reads the two-byte (0x81) length form", async () => {
        const { decodeAttributedBody } = await loadDecoder();
        const blob = blobOf(FIXTURES.LONG_INT16_LENGTH.hex);
        // The fixture really does exercise the wide form rather than merely being
        // long: `84 01 2B` is followed by 0x81 and a little-endian int16.
        const marker = blob.indexOf(Buffer.from([0x84, 0x01, 0x2b]));
        expect(blob[marker + 3]).toBe(0x81);
        expect(blob.readInt16LE(marker + 4)).toBe(Buffer.byteLength(FIXTURES.LONG_INT16_LENGTH.text, "utf8"));
        const decoded = decodeAttributedBody(blob);
        expect(decoded.status).toBe("text");
        expect(decoded.text).toBe(FIXTURES.LONG_INT16_LENGTH.text);
    });
    /*
     The other half of the old failure, and the quieter half.
  
     Where the class name did not win, the run still did not START where the
     message did: `84 01 2B 38` is the type token and the length, and when the
     message opened with a multi-byte character the run swallowed both and
     printed them. `café ...` was delivered to Nick as `+8café ...`. That reads
     like a typo rather than a bug, which is how it survived.
    */
    it("does not paste archive bytes onto the front of the message", async () => {
        const { decodeAttributedBody } = await loadDecoder();
        const hex = "040B73747265616D747970656481E803840140848484124E5341747472696275746564537472696E67008484084E534F626A656374008592848484084E53537472696E67019484012B38636166C3A9206E61C3AF76652072C3A973756DC3A920E2809420656D206461736820616E6420E2809C6375726C792071756F746573E2809D8684026949012E928484840C4E5344696374696F6E6172790094840169008686";
        const text = "café naïve résumé — em dash and “curly quotes”";
        expect(longestPrintableRun(hex)).toBe(`+8${text}`);
        expect(decodeAttributedBody(blobOf(hex))).toEqual({ status: "text", text });
    });
    it("reads the four-byte (0x82) length form", async () => {
        const { decodeAttributedBody } = await loadDecoder();
        // Built from the real 0x81 fixture by widening only the length field, so
        // everything around it stays byte-for-byte what Foundation wrote.
        const body = "y".repeat(40000);
        const head = Buffer.from("040B73747265616D747970656481E803840140848484124E5341747472696275746564537472696E67008484084E534F626A656374008592848484084E53537472696E67019484012B", "hex");
        const length = Buffer.alloc(5);
        length.writeUInt8(0x82, 0);
        length.writeInt32LE(body.length, 1);
        const blob = Buffer.concat([head, length, Buffer.from(body, "utf8"), Buffer.from([0x86])]);
        expect(decodeAttributedBody(blob)).toEqual({ status: "text", text: body });
    });
    it("names an attachment instead of returning a blank line", async () => {
        const { decodeAttributedBody, ATTACHMENT_MARKER } = await loadDecoder();
        // Text alongside the placeholder: the words survive, the placeholder goes.
        expect(decodeAttributedBody(blobOf(FIXTURES.WITH_ATTACHMENT.hex))).toEqual({
            status: "text",
            text: "check this out",
        });
        // Placeholder on its own: an attachment, said out loud.
        const head = Buffer.from("040B73747265616D747970656481E803840140848484124E5341747472696275746564537472696E67008484084E534F626A656374008592848484084E53537472696E67019484012B", "hex");
        const only = Buffer.from("￼", "utf8");
        const blob = Buffer.concat([head, Buffer.from([only.length]), only, Buffer.from([0x86])]);
        const decoded = decodeAttributedBody(blob);
        expect(decoded.status).toBe("attachment");
        expect(decoded.text).toBe(ATTACHMENT_MARKER);
    });
    /*
     The bar the old reader failed: a wrong message is worse than a missing one.
     Nick can act on "I could not read this". He cannot act on a sentence that
     was never sent.
    */
    it("never emits a class name, whatever it is handed", async () => {
        const { decodeAttributedBody, UNREADABLE_MARKER } = await loadDecoder();
        const nonsense = [
            ["empty", Buffer.alloc(0)],
            ["plain bytes", Buffer.from("just some bytes, not an archive")],
            ["header only", Buffer.from("040B73747265616D7479706564", "hex")],
            [
                "truncated mid-string",
                blobOf(FIXTURES.LONG_INT16_LENGTH.hex).subarray(0, 80),
            ],
            [
                "length runs past the end",
                Buffer.concat([
                    Buffer.from("040B73747265616D747970656481E803840140848484124E5341747472696275746564537472696E67008484084E534F626A656374008592848484084E53537472696E67019484012B", "hex"),
                    Buffer.from([0x7f]),
                    Buffer.from("short"),
                ]),
            ],
        ];
        for (const [label, blob] of nonsense) {
            const decoded = decodeAttributedBody(blob);
            expect(decoded.text, label).not.toMatch(/^NS[A-Z]/);
            expect(decoded.text, label).not.toContain("streamtyped");
            expect(["empty", "unreadable"], label).toContain(decoded.status);
            if (decoded.status === "unreadable") {
                expect(decoded.text, label).toBe(UNREADABLE_MARKER);
            }
        }
    });
    it("prefers message.text and falls back to the blob", async () => {
        const { messageBody } = await loadDecoder();
        // Older rows still carry a real `text` column; it wins and is not re-parsed.
        expect(messageBody({ text: "  plain column text  ", bodyHex: null })).toEqual({
            status: "text",
            text: "plain column text",
        });
        // Newer rows leave it NULL, which is the whole reason the decoder exists.
        expect(messageBody({ text: null, bodyHex: FIXTURES.SHORT_IMMUTABLE.hex })).toEqual({
            status: "text",
            text: "ok",
        });
        // Neither: a genuinely empty row, reported as empty rather than guessed at.
        expect(messageBody({ text: "   ", bodyHex: null })).toEqual({ status: "empty", text: "" });
    });
    /*
     A photo arrives with U+FFFC in the `text` column and nothing else. Against
     the real database this printed as
  
         23:05  Dad: ￼
  
     which is not a message, not an error, and not empty -- it is the character
     that marks where an image sits. Named, in both routes into the decoder.
    */
    it("names attachments arriving through the text column too", async () => {
        const { messageBody, ATTACHMENT_MARKER } = await loadDecoder();
        expect(messageBody({ text: "￼", bodyHex: null })).toEqual({
            status: "attachment",
            text: ATTACHMENT_MARKER,
        });
        // A caption alongside the photo is still the message.
        expect(messageBody({ text: "￼ look at this", bodyHex: null })).toEqual({
            status: "text",
            text: "look at this",
        });
        // Attachment in the column, caption in the blob: the caption wins.
        expect(messageBody({ text: "￼", bodyHex: FIXTURES.WITH_ATTACHMENT.hex })).toEqual({ status: "text", text: "check this out" });
    });
});
/*
 REGENERATING THE FIXTURES

 Compile and run this against Foundation; it prints the same hex as above.

   #import <Foundation/Foundation.h>
   int main(int argc, const char **argv) { @autoreleasepool {
     NSString *s = [NSString stringWithUTF8String:argv[1]];
     NSAttributedString *a = [[NSAttributedString alloc] initWithString:s];
     NSData *d = [NSArchiver archivedDataWithRootObject:a];
     const unsigned char *b = [d bytes];
     for (NSUInteger k = 0; k < [d length]; k++) printf("%02X", b[k]);
     return 0;
   } }

   clang -fobjc-arc -framework Foundation -Wno-deprecated-declarations -o gen gen.m

 Use NSMutableAttributedString plus an `__kIMMessagePartAttributeName` run to
 get the SHORT_MUTABLE shape.
*/
