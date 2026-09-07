import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  PERSONALITIES,
  PERSONALITY_IDS,
  PersonalityAuthorityViolation,
  composeConversationConfiguration,
  parsePersonalityProfile,
  type PersonalityProfile,
  type SessionAuthority,
} from "./personalities.js";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

interface SafeDiagnostic {
  readonly code: number;
  readonly message: string;
}

/** Every real .ts file already in src/, mirroring tsconfig.json's own "src/**\/*.ts". */
function listRealSourceFiles(dir: string): string[] {
  return [...ts.sys.readDirectory(dir, [".ts"])];
}

/**
 * A real, machine-checked instance of TypeScript's own compiler over a
 * fixture file that lives only in memory, compiled ALONGSIDE every real file
 * in src/ -- exactly the root-file set tsconfig.json's own "src/**\/*.ts"
 * produces, options included. That match matters: an isolated program built
 * from only the fixture and its direct imports resolves node builtins
 * (`node:path`, `Buffer`, `NodeJS`) differently than the real build does,
 * because ambient ammunition for those arrives through a file this narrower
 * slice would never pull in. Compiling the whole real program and then
 * reading back only the fixture's own diagnostics keeps the proof honest
 * without inheriting noise from files this test has nothing to do with.
 *
 * Returns plain `{code, message}` objects rather than raw `ts.Diagnostic`s.
 * A `ts.Diagnostic` holds a back-reference to its `SourceFile`, which holds
 * the whole `Program` -- a large, circular graph that is fine for the
 * compiler and not safe to hand to a test framework's own object printer if
 * an assertion on it ever fails. Stripping to primitives here keeps the
 * proof real without handing anything unserializable to `expect`.
 */
function typeCheckFixture(source: string): readonly SafeDiagnostic[] {
  const fixtureFileName = path.join(SRC_DIR, "__personality_authority_fixture__.ts");
  const rootNames = [...listRealSourceFiles(SRC_DIR), fixtureFileName];
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  };
  const host = ts.createCompilerHost(compilerOptions);
  const realGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fileName === fixtureFileName) {
      return ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TS);
    }
    return realGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const realFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => fileName === fixtureFileName || realFileExists(fileName);
  const realReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => (fileName === fixtureFileName ? source : realReadFile(fileName));

  const program = ts.createProgram(rootNames, compilerOptions, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  return diagnostics
    .filter((d) => d.file !== undefined && d.file.fileName === fixtureFileName)
    .map((d) => ({
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    }));
}

const VALID_LITERAL = `
import type { PersonalityProfile } from "./personalities.js";
const definition: PersonalityProfile = {
  id: "main",
  label: "Main",
  tone: "steady",
  memoryLean: "focused",
  planningStyle: "direct",
  modelRoleLean: "reasoning",
  sourceBreadth: "normal",
};
`;

// Each test in this block boots the real TypeScript compiler: 1-3s on a warm
// filesystem, 8-16s on a cold one. Vitest's 5s default therefore made them pass
// on this machine and fail on any cold checkout -- found when a git worktree ran
// them for the first time and all four "failed" without one assertion being
// wrong. A test whose verdict depends on the page cache proves nothing.
const COMPILER_TIMEOUT_MS = 60_000;

describe("compile-time proof: authority cannot be expressed on a personality", () => {
  it("the ordinary definition, with no authority field, type-checks with zero diagnostics", () => {
    const diagnostics = typeCheckFixture(VALID_LITERAL);
    expect(diagnostics.length).toBe(0);
  });

  it("the same literal with capabilityTier added FAILS TO COMPILE (TS2353, excess property)", () => {
    const withAuthority = VALID_LITERAL.replace(
      "sourceBreadth: \"normal\",",
      "sourceBreadth: \"normal\",\n  capabilityTier: \"self_modification\",",
    );
    const diagnostics = typeCheckFixture(withAuthority);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.code === 2353)).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("capabilityTier"))).toBe(true);
  });

  it("adding permissionProfile instead ALSO fails to compile", () => {
    const withAuthority = VALID_LITERAL.replace(
      "sourceBreadth: \"normal\",",
      "sourceBreadth: \"normal\",\n  permissionProfile: \"external_connected\",",
    );
    const diagnostics = typeCheckFixture(withAuthority);
    expect(diagnostics.some((d) => d.code === 2353)).toBe(true);
  });

  it("adding strictnessMode instead ALSO fails to compile", () => {
    const withAuthority = VALID_LITERAL.replace(
      "sourceBreadth: \"normal\",",
      "sourceBreadth: \"normal\",\n  strictnessMode: \"sovereign\",",
    );
    const diagnostics = typeCheckFixture(withAuthority);
    expect(diagnostics.some((d) => d.code === 2353)).toBe(true);
  });
}, COMPILER_TIMEOUT_MS);

describe("PERSONALITIES roster", () => {
  it("has exactly Main, Vent, Coach, Research, Creative", () => {
    expect(Object.keys(PERSONALITIES).sort()).toEqual(
      [...PERSONALITY_IDS].sort(),
    );
    expect(PERSONALITY_IDS).toEqual(["main", "vent", "coach", "research", "creative"]);
  });

  it("every personality round-trips through the runtime parser", () => {
    for (const id of PERSONALITY_IDS) {
      expect(parsePersonalityProfile(PERSONALITIES[id])).toEqual(PERSONALITIES[id]);
    }
  });
});

describe("parsePersonalityProfile: the runtime allowlist", () => {
  const base = {
    id: "research",
    label: "Research",
    tone: "thorough",
    memoryLean: "broad",
    planningStyle: "exploratory",
    modelRoleLean: "reasoning",
    sourceBreadth: "wide",
  };

  it("accepts a well-formed candidate", () => {
    expect(() => parsePersonalityProfile(base)).not.toThrow();
  });

  it.each([
    "capabilityTier",
    "permissionProfile",
    "strictnessMode",
    "tier",
    "grantScope",
    "execAllowlist",
    "filesystemRoot",
    "selfModification",
  ])("REJECTS a candidate carrying %s, by name, in the failure message", (field) => {
    const candidate = { ...base, [field]: "anything" };
    expect(() => parsePersonalityProfile(candidate)).toThrow(PersonalityAuthorityViolation);
    try {
      parsePersonalityProfile(candidate);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PersonalityAuthorityViolation);
      expect((err as Error).message).toContain(field);
      expect((err as Error).message).toContain("Unrestricted speech; restricted capabilities.");
    }
  });

  it("rejects a non-object candidate", () => {
    expect(() => parsePersonalityProfile("main")).toThrow(/must be a JSON object/);
    expect(() => parsePersonalityProfile(null)).toThrow(/must be a JSON object/);
    expect(() => parsePersonalityProfile(["main"])).toThrow(/must be a JSON object/);
  });

  it("rejects an unknown id, memoryLean, planningStyle, modelRoleLean or sourceBreadth", () => {
    expect(() => parsePersonalityProfile({ ...base, id: "villain" })).toThrow(/id must be one of/);
    expect(() => parsePersonalityProfile({ ...base, memoryLean: "everything" })).toThrow(
      /memoryLean must be one of/,
    );
    expect(() => parsePersonalityProfile({ ...base, planningStyle: "chaotic" })).toThrow(
      /planningStyle must be one of/,
    );
    expect(() => parsePersonalityProfile({ ...base, modelRoleLean: "gpt-5" })).toThrow(
      /modelRoleLean must be one of/,
    );
    expect(() => parsePersonalityProfile({ ...base, sourceBreadth: "infinite" })).toThrow(
      /sourceBreadth must be one of/,
    );
  });
});

describe("composeConversationConfiguration: authority passes through untouched", () => {
  const authority: SessionAuthority = {
    permissionProfile: "external_connected",
    strictnessMode: "guarded",
  };

  it("returns the exact SAME authority object, by reference, for every personality", () => {
    for (const id of PERSONALITY_IDS) {
      const config = composeConversationConfiguration(PERSONALITIES[id], authority);
      // Referential equality, not deep equality: this fails the instant the
      // function starts constructing a NEW authority object from personality
      // fields, which is the shape any accidental widening would take.
      expect(config.authority).toBe(authority);
      expect(config.personality).toBe(PERSONALITIES[id]);
    }
  });

  it("never reads a field off the personality that authority does not already have", () => {
    // A personality can carry only the seven PersonalityProfile fields (see
    // the allowlist above); none of those seven names anything present on
    // SessionAuthority, so there is no key collision for a careless merge to
    // exploit either.
    const personalityKeys = new Set(Object.keys(PERSONALITIES.creative));
    const authorityKeys = Object.keys(authority);
    for (const key of authorityKeys) {
      expect(personalityKeys.has(key)).toBe(false);
    }
  });
});
