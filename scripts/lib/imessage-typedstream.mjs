/*
 Decode the message body out of `message.attributedBody` in chat.db.

 WHY THIS FILE EXISTS

 Modern iMessage rows leave `message.text` NULL and put the body in
 `attributedBody`: an NSAttributedString serialised by NSArchiver in the old
 "typedstream" format. The first reader here did not parse that format. It
 decoded the blob as UTF-8, took the longest run of printable characters, and
 returned it.

 That is not a decode, it is a guess, and it loses the coin flip on exactly the
 messages people actually send. A typedstream carries the names of the classes
 it archived -- NSAttributedString, NSObject, NSMutableString -- as plain ASCII
 inside the blob, and those names are LONGER than a short reply. "ok" is two
 characters; `NSObject` is eight. The longest printable run in the archive of
 "ok" is the class name, so the reader returned the class name.

 The visible symptom was Nick's inbox reading:

     21:56  me: NSObject
     21:56  Karlita: NSObject

 which is worse than an error, because it looks like a message. Karlita did not
 type that. Nine of twelve messages one evening came back that way, and every
 one of them was a short reply -- the kind that makes up most of a conversation.

 A blocklist of class names was tried and is not a fix: it only renames the
 failure, because the next-longest run is another piece of archive scaffolding.
 There is no threshold at which "longest printable run" becomes correct. The
 format has to be read as a format.

 WHAT THE FORMAT ACTUALLY SAYS

 A typedstream opens with a signature and a system version:

     04 0b "streamtyped" 81 e8 03

 and then encodes objects. The part that matters here: a length-prefixed byte
 string is introduced by the type-encoding token "+", and the FIRST time a type
 encoding appears in a stream it is written out in full as

     84 <len> <chars>          -- 84 01 2B  is the token for "+"

 with later uses replaced by a back-reference byte. The message text is the
 first "+"-encoded string in the archive, and it is written as

     84 01 2B <length> <length bytes of UTF-8>

 so the body is delimited, not guessed. Its length is a typedstream integer:

     one byte            for 0 .. 127
     81 <int16 le>       for anything longer          <- 139-byte message
     82 <int32 le>       for anything longer still    <- 40,005-byte message
     83 <int64 le>       (never seen from Messages, handled for completeness)

 The two-byte 81 form is the common one the moment somebody writes more than a
 sentence, which is why a reader that only understands single-byte lengths
 appears to work in testing and then truncates real messages.

 Because the length is read from the stream, the body ends where the archive
 says it ends. The old reader had no end marker, so it ran on into the
 attribute-run table that follows the text and returned the message with a tail
 of mojibake attached -- and, when the text began with a multi-byte character,
 with the type token and length byte stuck to the FRONT of it ("+8café ...").
 Both of those stop being possible here rather than being cleaned up afterwards.

 WHAT THIS WILL NEVER DO

 Return a class name. If the body cannot be read, this says so with an explicit
 marker and a status the caller can branch on. A wrong message is worse than a
 missing one: Nick can act on "I could not read this", and cannot act on a
 sentence that was never sent. That is the whole reason this file is not a
 regex.
*/

/** Bytes 0..12 of every typedstream Messages writes. */
const SIGNATURE = Buffer.from([0x04, 0x0b, ...Buffer.from("streamtyped", "ascii")]);

/** `84 01 2B` -- the first, written-out-in-full use of the "+" type encoding. */
const NEW_BYTE_STRING = Buffer.from([0x84, 0x01, 0x2b]);

/** Integer width markers. Anything else is a literal single byte. */
const INT16 = 0x81;
const INT32 = 0x82;
const INT64 = 0x83;

/**
 * Archive scaffolding that must never reach Nick as a message body.
 *
 * The parser below cannot emit these -- it reads the body from a delimited
 * field, not from a scan -- so this is a backstop, not the mechanism. It is
 * here because the previous reader's failure was silent and looked like
 * content, and a second pair of eyes on that specific failure is cheap.
 */
const ARCHIVE_TOKENS = new Set([
  "NSObject",
  "NSString",
  "NSMutableString",
  "NSAttributedString",
  "NSMutableAttributedString",
  "NSDictionary",
  "NSMutableDictionary",
  "NSArray",
  "NSMutableArray",
  "NSNumber",
  "NSValue",
  "NSData",
  "NSFont",
  "NSColor",
  "streamtyped",
]);

/** U+FFFC OBJECT REPLACEMENT CHARACTER -- where an attachment sits in the text. */
const ATTACHMENT_PLACEHOLDER = "￼";

/** Said out loud when the blob is there but unreadable. Never a class name. */
export const UNREADABLE_MARKER = "[unreadable message body]";

/** Said out loud when the message is an attachment with no words of its own. */
export const ATTACHMENT_MARKER = "[attachment]";

/**
 * Read a typedstream integer at `offset`.
 *
 * Returns `null` rather than throwing on a truncated blob: a half-written row
 * is a thing that exists in a live database being read with immutable=1, and it
 * should degrade to "could not read this one" instead of taking down a whole
 * `messages recent` call.
 */
function readInteger(buffer, offset) {
  if (offset >= buffer.length) return null;
  const marker = buffer[offset];

  if (marker === INT16) {
    if (offset + 3 > buffer.length) return null;
    return { value: buffer.readInt16LE(offset + 1), next: offset + 3 };
  }
  if (marker === INT32) {
    if (offset + 5 > buffer.length) return null;
    return { value: buffer.readInt32LE(offset + 1), next: offset + 5 };
  }
  if (marker === INT64) {
    if (offset + 9 > buffer.length) return null;
    const wide = buffer.readBigInt64LE(offset + 1);
    // A body longer than a 32-bit length is not a body, it is a corrupt row.
    if (wide < 0n || wide > 0x7fffffffn) return null;
    return { value: Number(wide), next: offset + 9 };
  }
  // Everything else is the value itself. Lengths are never negative, so a byte
  // above 0x7F here means the stream is not where we think it is.
  if (marker > 0x7f) return null;
  return { value: marker, next: offset + 1 };
}

/**
 * The body, as the archive delimits it.
 *
 * Deliberately does NOT search for "something that looks like text". It finds
 * the one token that introduces a length-prefixed string, reads the declared
 * length, and takes exactly that many bytes. If any of that does not line up,
 * it gives up and says so.
 */
function readDelimitedString(buffer) {
  const marker = buffer.indexOf(NEW_BYTE_STRING);
  if (marker === -1) return null;

  const length = readInteger(buffer, marker + NEW_BYTE_STRING.length);
  if (!length || length.value < 0) return null;
  if (length.value === 0) return { text: "" };

  const end = length.next + length.value;
  if (end > buffer.length) return null;

  return { text: buffer.subarray(length.next, end).toString("utf8") };
}

/**
 * Decode one `attributedBody` blob.
 *
 * @param {Buffer|Uint8Array|null|undefined} blob
 * @returns {{ status: "empty"|"text"|"attachment"|"unreadable", text: string }}
 *
 * `status` exists so the caller can tell three different things apart that all
 * used to arrive as an empty string: there was no blob, there was a blob and it
 * held an attachment, and there was a blob that could not be read. Reporting
 * the third as "no messages" is the failure mode this whole file is about.
 */
/**
 * Turn one recovered string into an answer.
 *
 * Shared by both routes into this file, because an attachment looks the same
 * whether it arrived in the `text` column or in the blob, and it was wrong in
 * both places. A photo from his father rendered as
 *
 *     23:05  Dad: ￼
 *
 * which is a real character (U+FFFC, OBJECT REPLACEMENT) sitting where the
 * image goes. It is not a message and it is not empty, and printing it raw
 * makes Orion look like he is reading a corrupted feed.
 */
function interpret(raw) {
  const text = raw.split(ATTACHMENT_PLACEHOLDER).join(" ").replace(/\s+/g, " ").trim();

  if (!text) {
    return raw.includes(ATTACHMENT_PLACEHOLDER)
      ? { status: "attachment", text: ATTACHMENT_MARKER }
      : { status: "empty", text: "" };
  }

  // Backstop. See ARCHIVE_TOKENS.
  if (ARCHIVE_TOKENS.has(text)) {
    return { status: "unreadable", text: UNREADABLE_MARKER };
  }

  return { status: "text", text };
}

export function decodeAttributedBody(blob) {
  if (!blob || blob.length === 0) return { status: "empty", text: "" };

  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);

  // Not a typedstream at all. Refuse rather than fall back to scanning, which
  // is precisely the behaviour that produced "NSObject".
  if (!buffer.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    return { status: "unreadable", text: UNREADABLE_MARKER };
  }

  const found = readDelimitedString(buffer);
  if (!found) return { status: "unreadable", text: UNREADABLE_MARKER };

  return interpret(found.text);
}

/**
 * `message.text` first, `attributedBody` second.
 *
 * Kept here rather than in the reader so that anything else that grows a need
 * to read chat.db gets the same answer. The hex spelling is what sqlite3 -json
 * can actually carry: a BLOB does not survive JSON, so the query asks for
 * `hex(attributedBody)` and it is rehydrated here.
 */
export function messageBody({ text, bodyHex }) {
  if (typeof text === "string" && text.trim()) {
    const fromColumn = interpret(text);
    // An attachment-only `text` column is not a body. Fall through to the blob,
    // which sometimes carries a caption the column does not.
    if (fromColumn.status === "text") return fromColumn;
    if (fromColumn.status === "attachment" && bodyHex) {
      const fromBlob = decodeAttributedBody(Buffer.from(bodyHex, "hex"));
      if (fromBlob.status === "text") return fromBlob;
    }
    return fromColumn;
  }
  if (!bodyHex) return { status: "empty", text: "" };
  return decodeAttributedBody(Buffer.from(bodyHex, "hex"));
}
