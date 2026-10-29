import hljs from "highlight.js/lib/common";

/** A run of one line's text that is drawn in one style. */
export type Segment = {
  /** The characters in the run. */
  text: string;
  /** The highlight.js class for what the run is, when it is anything. */
  className?: string;
};

/** The languages a patch's file extension is drawn with. */
const EXTENSION_LANGUAGES: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cfg: "ini",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  ex: "elixir",
  exs: "elixir",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "xml",
  html: "xml",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  mts: "typescript",
  php: "php",
  pl: "perl",
  ps1: "powershell",
  psm1: "powershell",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scala: "scala",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  vue: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

/** The characters highlight.js writes as entities, and what they stand for. */
const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
};

/**
 * Decodes one entity in a highlighted fragment.
 *
 * @param entity - The entity, ampersand and semicolon included.
 * @returns The character it stands for, or the entity itself when it is not one
 *   this knows.
 */
function decodeEntity(entity: string): string {
  const named = NAMED_ENTITIES[entity];
  if (named) return named;

  const numeric = /^&#(?:x([0-9a-f]+)|(\d+));$/i.exec(entity);
  if (!numeric) return entity;

  const code = numeric[1] ? Number.parseInt(numeric[1], 16) : Number.parseInt(numeric[2], 10);
  return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
}

/**
 * Splits a highlighted fragment into one run per line.
 *
 * The fragment is the whole side of a patch, highlighted once, so a construct
 * that spans lines — a block comment, a template literal — is coloured as one
 * thing. The classes open on one line are carried onto the next, which is what
 * keeps a multi-line string's middle lines coloured.
 *
 * @param html - The fragment highlight.js produced.
 * @returns The runs of each line, in order.
 */
export function segmentsFromHtml(html: string): Segment[][] {
  const lines: Segment[][] = [[]];
  const open: string[] = [];

  const className = (): string | undefined => {
    const joined = open.filter((name) => name.length > 0).join(" ");
    return joined.length > 0 ? joined : undefined;
  };

  const push = (text: string): void => {
    if (text.length === 0) return;
    const parts = text.split("\n");

    for (const [at, part] of parts.entries()) {
      if (at > 0) lines.push([]);
      if (part.length === 0) continue;

      const line = lines[lines.length - 1];
      const style = className();
      const last = line[line.length - 1];
      if (last && last.className === style) last.text += part;
      else line.push({ text: part, className: style });
    }
  };

  let index = 0;
  while (index < html.length) {
    if (html.startsWith("<span", index)) {
      const close = html.indexOf(">", index);
      if (close < 0) break;
      const match = /class="([^"]*)"/.exec(html.slice(index, close + 1));
      open.push(match?.[1] ?? "");
      index = close + 1;
      continue;
    }

    if (html.startsWith("</span>", index)) {
      open.pop();
      index += "</span>".length;
      continue;
    }

    if (html[index] === "&") {
      const end = html.indexOf(";", index);
      if (end > index) {
        push(decodeEntity(html.slice(index, end + 1)));
        index = end + 1;
        continue;
      }
    }

    let next = index;
    while (next < html.length && html[next] !== "<" && html[next] !== "&") next += 1;
    push(html.slice(index, next));
    index = next;
  }

  return lines;
}

/**
 * Reads the language a file name is drawn in.
 *
 * @param path - The file's path, whatever separators it uses.
 * @returns The highlight.js language, or null when the extension is not one this
 *   knows.
 */
export function languageOfPath(path: string | null | undefined): string | null {
  if (!path) return null;

  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;

  const language = EXTENSION_LANGUAGES[name.slice(dot + 1).toLowerCase()];
  return language && hljs.getLanguage(language) ? language : null;
}

/**
 * Reads the language a patch is written in.
 *
 * The `+++` line names the new file, and a deleted file names `/dev/null` there
 * instead, so the `---` line is the fallback. An edit rendered from the CLI's
 * `structuredPatch` has neither — it is hunks alone — so the card passes the
 * path from the call's own input as `filePath`.
 *
 * @param lines - The lines of the patch.
 * @param filePath - The file the patch belongs to, when the patch does not name
 *   it itself.
 * @returns The highlight.js language, or null when the file is not a kind this
 *   knows.
 */
export function languageOfPatch(lines: readonly string[], filePath?: string | null): string | null {
  const added = lines.find((line) => line.startsWith("+++ ") && !line.includes("/dev/null"));
  const header =
    added ?? lines.find((line) => line.startsWith("--- ") && !line.includes("/dev/null"));

  if (!header) return languageOfPath(filePath);
  return languageOfPath(header.slice(4).trim().split("\t")[0]);
}

/**
 * Highlights one side of a patch as a whole, and splits it back into lines.
 *
 * @param lines - The lines of that side.
 * @param language - The language to draw them in, or null to leave them plain.
 * @returns The runs of each line, in order.
 */
export function highlightSide(lines: readonly string[], language: string | null): Segment[][] {
  const plain = (): Segment[][] => lines.map((line) => (line.length > 0 ? [{ text: line }] : []));

  if (language === null) return plain();

  try {
    const html = hljs.highlight(lines.join("\n"), { language, ignoreIllegals: true }).value;
    const parsed = segmentsFromHtml(html);
    return lines.map((_, index) => parsed[index] ?? []);
  } catch {
    return plain();
  }
}
