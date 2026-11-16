import type { MemoryResult, ProfileResult } from "./api.ts";

/** Extract the deletable memory id from a search/list result. */
export function memoryId(memory: MemoryResult): string {
  return memory.documents?.[0]?.id ?? memory.id ?? "";
}

/** Extract the human-readable content from a search/list result. */
export function memoryContent(memory: MemoryResult): string {
  return memory.memory || memory.chunk || memory.content || memory.summary || "";
}

/** Short "how old" label from an ISO createdAt, for snapshot lines. */
export function relativeAge(createdAt?: string, now = Date.now()): string {
  if (!createdAt) return "";
  const then = Date.parse(createdAt);
  if (!Number.isFinite(then) || then > now) return "";
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export interface MemoryContextOptions {
  profile: ProfileResult | null;
  /** Recent project memories (recency-based snapshot). */
  snapshot: MemoryResult[];
  /** Semantically matched memories, project and personal combined. */
  relevant: Array<{ memory: MemoryResult; scope: "project" | "personal" }>;
  maxProfileItems: number;
  maxContextChars: number;
  /** Clock override for deterministic age labels in tests. */
  now?: number;
}

/** Format recalled memories into a compact context block for the LLM. */
export function formatMemoryContext(options: MemoryContextOptions): string {
  const { profile, snapshot, relevant, maxProfileItems, maxContextChars, now } = options;
  const header = "[Supermemory — persistent memory recalled for this project]";
  const budget = Math.max(0, maxContextChars - header.length);

  const lines: string[] = [];
  let used = 0;
  const push = (line: string): boolean => {
    if (used + line.length + 1 > budget) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };

  if (profile && (profile.static.length > 0 || profile.dynamic.length > 0)) {
    const section = ["User Profile:"];
    for (const line of profile.static.slice(0, maxProfileItems)) section.push(`- ${line}`);
    for (const line of profile.dynamic.slice(0, maxProfileItems)) section.push(`- ${line}`);
    if (!push(section.join("\n"))) return block(header, lines);
  }

  const snapshotIds = new Set<string>();
  if (snapshot.length > 0) {
    const sectionHeader = "Recent Project Snapshot (latest first):";
    let opened = false;
    for (const memory of snapshot) {
      const age = relativeAge(memory.createdAt, now);
      const content = memoryContent(memory);
      if (!content) continue;
      const id = memoryId(memory);
      if (id) snapshotIds.add(id);
      const line = `- ${age ? `[${age}] ` : ""}${content}`;
      // First entry travels with its section header so we never emit an empty header.
      if (!opened) {
        if (!push(`${sectionHeader}\n${line}`)) return block(header, lines);
        opened = true;
      } else if (!push(line)) {
        return block(header, lines);
      }
    }
  }

  if (relevant.length > 0) {
    // Highest similarity first; skip memories already shown in the snapshot.
    const ordered = [...relevant].sort(
      (a, b) => (b.memory.similarity ?? 0) - (a.memory.similarity ?? 0),
    );
    let opened = false;
    for (const { memory, scope } of ordered) {
      const content = memoryContent(memory);
      if (!content) continue;
      if (snapshotIds.has(memoryId(memory))) continue;
      const similarity = Math.round((memory.similarity ?? 0) * 100);
      const line = `- [${scope}, ${similarity}%] ${content}`;
      if (!opened) {
        if (push(`\nRelevant Memories:\n${line}`)) opened = true;
      } else {
        push(line);
      }
    }
  }

  return block(header, lines);
}

function block(header: string, lines: string[]): string {
  if (lines.length === 0) return "";
  return `${header}\n${lines.join("\n")}`;
}
