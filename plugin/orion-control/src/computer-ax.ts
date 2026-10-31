/**
 * The accessibility tree as the computer loop sees it (2026-10-30).
 *
 * `screen_observe` returns the focused window as a nested tree. The loop needs it flat: every node with the
 * child-index path the bridge's `screen_press` / `screen_set_value` address it by, so an element found here is
 * the element acted on there (the bridge re-checks role and label at that path and refuses a stale one).
 *
 * Everything read off the screen is DATA. Labels and values are matched against words Nick said and shown to
 * the model only as numbered, quoted candidates; nothing in this file turns screen text into an action.
 */

export type AxNode = {
  readonly role: string;
  readonly subrole?: string | null;
  readonly label?: string | null;
  readonly value?: string | null;
  readonly x?: number | null;
  readonly y?: number | null;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly children?: readonly AxNode[];
};

export type Observation = {
  readonly appName: string;
  readonly bundleId: string;
  readonly windowTitle: string | null;
  readonly element: AxNode | null;
  readonly truncated?: boolean;
};

export type FlatNode = {
  /** "" is the window itself; "0.3" its first child's fourth child. */
  readonly path: string;
  readonly role: string;
  readonly subrole: string | null;
  readonly label: string | null;
  readonly value: string | null;
  readonly depth: number;
  readonly parentRole: string | null;
  readonly center: { readonly x: number; readonly y: number } | null;
};

export type RoleGroup = "pressable" | "editable" | "tab" | "scrollable" | "any";

const ROLES: Record<Exclude<RoleGroup, "any">, ReadonlySet<string>> = {
  pressable: new Set(["AXButton", "AXMenuItem", "AXMenuButton", "AXRadioButton", "AXCheckBox", "AXLink", "AXPopUpButton", "AXTab", "AXDisclosureTriangle", "AXCell", "AXRow"]),
  editable: new Set(["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]),
  tab: new Set(["AXRadioButton", "AXTab"]),
  scrollable: new Set(["AXScrollArea", "AXWebArea"]),
};

export function inGroup(node: Pick<FlatNode, "role" | "subrole">, group: RoleGroup): boolean {
  if (group === "any") return true;
  if (group === "editable" && node.subrole === "AXSearchField") return true;
  return ROLES[group].has(node.role);
}

function centerOf(node: AxNode): FlatNode["center"] {
  const { x, y, width, height } = node;
  if ([x, y, width, height].some((v) => typeof v !== "number")) return null;
  return { x: (x as number) + (width as number) / 2, y: (y as number) + (height as number) / 2 };
}

/** Depth-first, parent before children, in the bridge's own child order. */
export function flatten(root: AxNode | null): FlatNode[] {
  if (!root) return [];
  const out: FlatNode[] = [];
  const visit = (node: AxNode, path: string, depth: number, parentRole: string | null): void => {
    out.push({
      path, role: node.role, subrole: node.subrole ?? null, label: node.label ?? null, value: node.value ?? null,
      depth, parentRole, center: centerOf(node),
    });
    (node.children ?? []).forEach((child, i) => visit(child, path === "" ? String(i) : `${path}.${i}`, depth + 1, node.role));
  };
  visit(root, "", 0, null);
  return out;
}

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const STOP = new Set(["the", "a", "an", "my", "this", "that", "on", "in", "of", "to", "button", "field", "box", "tab", "link", "page", "thing", "one"]);

function tokens(text: string): string[] {
  return normalise(text).split(" ").filter((t) => t && !STOP.has(t));
}

/** 0..1: exact 1, whole-phrase containment 0.85, otherwise the share of his words found in the label. */
export function similarity(wanted: string, label: string): number {
  const a = normalise(wanted);
  const b = normalise(label);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.85;
  const want = tokens(wanted);
  if (want.length === 0) return 0;
  const have = new Set(tokens(label));
  const hits = want.filter((t) => have.has(t) || [...have].some((h) => h.startsWith(t) || t.startsWith(h))).length;
  return 0.8 * (hits / want.length);
}

/** The text a node is known by: its label, or for an empty-labelled field its value. */
export function nameOf(node: FlatNode): string {
  return (node.label ?? "").trim() || (inGroup(node, "editable") ? "" : (node.value ?? "").trim());
}

export type Candidate = { readonly node: FlatNode; readonly score: number };

/** Nodes in the role group, best match first. An empty `wanted` (a generic "the button") scores every node 0.5. */
export function candidates(nodes: readonly FlatNode[], group: RoleGroup, wanted: string): Candidate[] {
  const scored = nodes
    .filter((n) => inGroup(n, group))
    .map((node) => ({ node, score: wanted.trim() ? similarity(wanted, nameOf(node)) : 0.5 }))
    .filter((c) => c.score > 0);
  return scored.sort((a, b) => b.score - a.score || a.node.depth - b.node.depth);
}

/** One clear winner, or null when the top two are too close to call (the model, or Nick, picks then). */
export function clearWinner(list: readonly Candidate[]): Candidate | null {
  const [first, second] = list;
  if (!first || first.score < 0.5) return null;
  if (!second) return first;
  return first.score - second.score >= 0.15 ? first : null;
}

/** Visible text, in reading order, without repeats: what a screen-read answer is built from. */
export function visibleText(nodes: readonly FlatNode[], limit = 60): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.role === "AXWindow" || node.role === "AXMenuBar") continue;
    const text = (node.role === "AXStaticText" || inGroup(node, "editable") ? node.value ?? node.label : node.label ?? "")
      ?.replace(/\s+/g, " ").trim();
    if (!text || text === "<redacted-secure-field>" || seen.has(text)) continue;
    seen.add(text);
    out.push(text.slice(0, 400));
    if (out.length >= limit) break;
  }
  return out;
}

/** A cheap fingerprint of what is on screen, for "did anything change". */
export function fingerprint(observation: Observation | null): string {
  if (!observation) return "";
  const parts = flatten(observation.element).map((n) => `${n.path}|${n.role}|${n.label ?? ""}|${(n.value ?? "").slice(0, 80)}`);
  return `${observation.bundleId}|${observation.windowTitle ?? ""}|${parts.join("\n")}`;
}

/** Numbered candidate lines for the model. Labels are quoted and clipped: they are data, not instructions. */
export function candidateLines(list: readonly Candidate[], max = 8): string[] {
  return list.slice(0, max).map((c, i) => `${i + 1}. ${c.node.role.replace(/^AX/, "")} ${JSON.stringify(nameOf(c.node).slice(0, 60))}`);
}
