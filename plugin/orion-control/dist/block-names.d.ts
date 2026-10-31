/** Course code ("mktg2201") → his subject words for it ("marketing"), from data. */
export type CourseAliases = ReadonlyMap<string, readonly string[]>;
export type NameIntent = "class" | "study" | undefined;
export type NamedBlock = {
    title: string;
    start: string;
    end: string;
    kind?: string;
    fixed?: boolean;
};
export type Resolved<B> = {
    block: B;
} | {
    ambiguous: B[];
} | undefined;
export declare const norm: (t: string) => string;
/** One word of his is one word of the title: the same, one the start of the other (4+ letters, or a code), or a small typo. */
export declare function sameWord(said: string, word: string): boolean;
export type SpokenName = {
    words: string[];
    wantsClass: boolean;
};
export declare function spokenName(name: string): SpokenName;
/** Whether a phrase is only filler and kind words ("my class", "the lecture"): it names no block by itself. */
export declare const isGenericName: (name: string) => boolean;
/** The words a title answers to: its own, then its codes' subject words from data, then the codes' generic words. */
export declare function titleWords(title: string, aliases?: CourseAliases): {
    own: string[];
    data: string[];
    generic: string[];
};
/** Every word a title answers to, flat (for the lenient guards that look for any one shared word). */
export declare const allTitleWords: (title: string, aliases?: CourseAliases) => string[];
/** How well his name fits a title: 3 the same title, 2 its words or its course's subject from data, 1 only the code's generic words, 0 not it. */
export declare function nameLevel(name: string, title: string, aliases?: CourseAliases): 0 | 1 | 2 | 3;
/** Whether his name for a block is this title (any level). */
export declare const namesTitle: (name: string, title: string, aliases?: CourseAliases) => boolean;
/** A class: the scheduler says so, or a fixed block whose title starts with a course code. */
export declare const isClassBlock: (b: {
    title: string;
    kind?: string;
    fixed?: boolean;
}) => boolean;
/** What the verb around a name implies he means: the class (attend, skip, late, missed) or the study block (study, work on). */
export declare function intentOf(text: string): NameIntent;
/** Every block on the day his name fits, at the best level any of them reaches; "marketing class" keeps the classes when there are any. */
export declare function blocksNamedBy<B extends NamedBlock>(name: string, blocks: readonly B[], opts?: {
    aliases?: CourseAliases;
    intent?: NameIntent;
}): B[];
/** The one block he means: one still ahead (earliest) first, else the latest that ended. A class and a study block by the same name,
 *  with no verb to tell them apart: ambiguous (ask with whichOne). */
export declare function resolveBlockName<B extends NamedBlock>(name: string, blocks: readonly B[], opts: {
    now: number;
    aliases?: CourseAliases;
    intent?: NameIntent;
}): Resolved<B>;
export declare function pickByTime<B extends NamedBlock>(found: readonly B[], now: number): B;
/** "Do you mean ECON1115 at 11:00 AM or Econ problem set at 3:00 PM? I haven't changed anything." */
export declare function whichOne(blocks: readonly NamedBlock[]): string;
/** His subject words in a course's long name ("Principles of Macroeconomics 2026/27" → ["macroeconomics"]). */
export declare function subjectWords(text: string): string[];
/** "ECON1115 Macro", "MKTG2201 Marketing", "CS2100 is Program Design & Implementation 1" in free text (USER.md, notes). */
export declare function coursesInText(text: string, into?: Map<string, Set<string>>): Map<string, Set<string>>;
/** A brain course note (`<CODE>.md`): its "[name]" and "[course_code]" lines. */
export declare function courseNote(code: string, text: string, into?: Map<string, Set<string>>): Map<string, Set<string>>;
export type AliasSources = {
    userMd?: string;
    coursesDir?: string;
    lifeConfig?: string;
};
export declare function defaultAliasSources(): AliasSources;
/** Reads every source that exists; a missing or unreadable one adds nothing. Never throws. */
export declare function loadCourseAliases(src: AliasSources): CourseAliases;
/** His course aliases from the default sources, cached; re-read when a source changes (checked at most every 30 s). */
export declare function courseAliases(): CourseAliases;
/** Tests: use these aliases instead of the files (undefined goes back to the files). */
export declare function useCourseAliases(aliases: CourseAliases | undefined): void;
