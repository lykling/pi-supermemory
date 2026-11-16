import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Settings resolved from env vars and config files. */
export interface SupermemorySettings {
  apiKey: string | undefined;
  baseUrl: string;
  /** Recall strategy for the first prompt of each session. */
  autoRecall: "hybrid" | "full" | "profile" | "off";
  similarityThreshold: number;
  maxMemories: number;
  maxProjectMemories: number;
  maxProfileItems: number;
  /** Size of the "recent work snapshot" injected at session start and after compaction. */
  snapshotCount: number;
  /** Hard budget for the injected memory context block, in characters. */
  maxContextChars: number;
  /** Re-inject profile + snapshot after context compaction. */
  compactReinject: boolean;
  /** Similarity above which add-mode refuses once and suggests replacing the old memory. */
  dedupeThreshold: number;
  /** Run the near-duplicate check in add mode. */
  dedupeOnAdd: boolean;
}

const DEFAULT_BASE_URL = "https://api.supermemory.ai";

/**
 * Strip line and block comments plus trailing commas so JSONC files parse.
 * Port of the jsonc parser used by opencode-supermemory.
 */
export function stripJsoncComments(content: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];
    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === '"') {
        let backslashCount = 0;
        let j = i - 1;
        while (j >= 0 && content[j] === "\\") {
          backslashCount++;
          j--;
        }
        if (backslashCount % 2 === 0) {
          inString = !inString;
        }
        result += char;
        i++;
        continue;
      }
    }
    if (inString) {
      result += char;
      i++;
      continue;
    }
    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === "/" && nextChar === "/") {
        inSingleLineComment = true;
        i += 2;
        continue;
      }
      if (char === "/" && nextChar === "*") {
        inMultiLineComment = true;
        i += 2;
        continue;
      }
    }
    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false;
        result += char;
      }
      i++;
      continue;
    }
    if (inMultiLineComment) {
      if (char === "*" && nextChar === "/") {
        inMultiLineComment = false;
        i += 2;
        continue;
      }
      if (char === "\n") {
        result += char;
      }
      i++;
      continue;
    }
    result += char;
    i++;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

/** Read and parse a JSON or JSONC file, returning null on any failure. */
export function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(stripJsoncComments(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Resolve credentials and settings.
 *
 * API key precedence (later sources reuse credentials you already have):
 * 1. SUPERMEMORY_API_KEY env var
 * 2. ~/.pi/agent/supermemory.json           (pi-native config)
 * 3. ~/.config/opencode/supermemory.jsonc   (shared with opencode plugin)
 * 4. ~/.supermemory-opencode/credentials.json (opencode device-flow login)
 */
export function resolveSettings(): SupermemorySettings {
  const piConfig = readJsonFile(join(homedir(), ".pi", "agent", "supermemory.json"));
  const opencodeConfig = readJsonFile(
    join(homedir(), ".config", "opencode", "supermemory.jsonc"),
  );
  const opencodeCredentials = readJsonFile(
    join(homedir(), ".supermemory-opencode", "credentials.json"),
  );

  const apiKey = firstString(
    process.env.SUPERMEMORY_API_KEY,
    piConfig?.apiKey,
    opencodeConfig?.apiKey,
    opencodeCredentials?.apiKey,
  );
  const baseUrl = firstString(
    process.env.SUPERMEMORY_API_BASE_URL,
    piConfig?.apiBaseUrl,
    opencodeConfig?.apiBaseUrl,
    opencodeCredentials?.apiBaseUrl,
    DEFAULT_BASE_URL,
  ) as string;

  const autoRecallRaw = firstString(piConfig?.autoRecall);
  const autoRecall: SupermemorySettings["autoRecall"] =
    autoRecallRaw === "hybrid" ||
    autoRecallRaw === "full" ||
    autoRecallRaw === "profile" ||
    autoRecallRaw === "off"
      ? autoRecallRaw
      : "hybrid";

  const num = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;

  return {
    apiKey,
    baseUrl,
    autoRecall,
    similarityThreshold: num(piConfig?.similarityThreshold, 0.6),
    maxMemories: num(piConfig?.maxMemories, 5),
    maxProjectMemories: num(piConfig?.maxProjectMemories, 10),
    maxProfileItems: num(piConfig?.maxProfileItems, 5),
    snapshotCount: num(piConfig?.snapshotCount, 3),
    maxContextChars: num(piConfig?.maxContextChars, 4000),
    compactReinject: bool(piConfig?.compactReinject, true),
    dedupeThreshold: num(piConfig?.dedupeThreshold, 0.9),
    dedupeOnAdd: bool(piConfig?.dedupeOnAdd, true),
  };
}
