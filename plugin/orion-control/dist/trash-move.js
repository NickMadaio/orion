const VERB = /\b(?:delete|remove|trash|bin|get rid of|throw (?:away|out)|toss|erase|move\b.{1,80}?\bto (?:the )?(?:trash|bin|recycle bin|rubbish))\b/i;
const QUOTED = /"([^"]{1,120})"|'([^']{1,120})'|“([^”]{1,120})”/;
const FILE = /(?:^|[\s(])([\w()-][\w.()-]{0,100}\.[a-z][a-z0-9]{0,5})(?=$|[\s,;:!?)])/i;
const FOLDER_NAMED = /\b(?:folder|directory|dir)\s+(?:called|named)\s+([\w.()-]{1,80})/i;
const FOLDER_BEFORE = /\b(?:delete|remove|trash|bin|get rid of|throw (?:away|out)|toss|erase)\s+(?:the |my |that |this )?([\w.()-]{1,80})\s+(?:folder|directory|dir)\b/i;
const ROOT = /\b(desktop|documents|docs|downloads?)\b/i;
const WITHIN = [
    /\b(?:from|in|inside|out of|on|under)\s+(?:the |my )?([\w.()-]{1,80})\s+(?:folder|directory|dir)\b/i,
    /\b(?:desktop|documents|docs|downloads?)\/([\w.()-]{1,80})/i,
    /\b(?:from|in|inside|out of|on|under)\s+(?:the |my )?(?:folder|directory|dir)\s+(?:called |named )?([\w.()-]{1,80})/i,
];
const ROOT_NAME = /^(?:desktop|documents|docs|downloads?|home|library|applications)$/i;
const rootOf = (word) => {
    const w = (word ?? "").toLowerCase();
    return w.startsWith("desk") ? "desktop" : w.startsWith("doc") ? "documents" : w.startsWith("download") ? "downloads" : undefined;
};
/** The named item, its kind, and where he said it is; undefined when no item is named. */
export function readTrash(message) {
    const m = message.trim();
    if (m.length > 240 || !VERB.test(m) || /\?\s*$/.test(m))
        return undefined;
    const quoted = QUOTED.exec(m);
    const quotedName = quoted ? (quoted[1] ?? quoted[2] ?? quoted[3]).trim() : undefined;
    const file = quotedName && /\.[a-z][a-z0-9]{0,5}$/i.test(quotedName) ? quotedName : FILE.exec(m)?.[1];
    const folderName = file ? undefined : (FOLDER_NAMED.exec(m)?.[1] ?? FOLDER_BEFORE.exec(m)?.[1] ?? quotedName);
    const name = file ?? folderName;
    if (!name || /^(?:the|my|this|that|whole|entire|old|stuff)$/i.test(name))
        return undefined;
    if (/^https?:|@|\.(?:com|org|net|io|co|uk|edu)$/i.test(name))
        return undefined; // a website or an address, not a file
    const root = rootOf(ROOT.exec(m.replace(name, " "))?.[1]);
    const within = WITHIN.map((re) => re.exec(m)?.[1]).find((w) => w && w.toLowerCase() !== name.toLowerCase() && !ROOT_NAME.test(w));
    return { kind: "trash", name: ROOT_NAME.test(name) ? name.toLowerCase() : name, folder: !file, ...(root ? { root } : {}), ...(within ? { within } : {}) };
}
