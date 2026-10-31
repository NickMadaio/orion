// Basic Memory's CLI argument shapes. The CLI renamed its tool commands (search-notes -> search, read-note -> read,
// write-note -> write, edit-note -> edit, build-context -> context, recent-activity -> project recent), so every
// orion-brain call that went through the old names failed with "No such command". Kept in one place, pure, testable.
const PROJECT = ["--project", "orion"];
export const bmArgs = {
  // REV2 BRAIN: no --compact, so each result carries its matched chunk and the reply can quote it.
  search: (q) => ["tool", "search", q, ...PROJECT, "--json"],
  read: (title) => ["tool", "read", title, ...PROJECT],
  context: (title) => ["tool", "context", `memory://${title}`, ...PROJECT],
  recent: () => ["tool", "project", "recent", "--since", "7d", ...PROJECT],
  write: ({ title, directory, noteType, content }) =>
    ["tool", "write", "--title", title, "--directory", directory, "--note-type", noteType, "--content", content, ...PROJECT],
  append: (title, content) => ["tool", "edit", title, "--command", "append", "--content", content, ...PROJECT],
};
