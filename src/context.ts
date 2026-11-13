import type { MemoryResult, ProfileResult } from "./api.ts";

/** Format recalled memories into a compact context block for the LLM. */
export function formatMemoryContext(options: {
  profile: ProfileResult | null;
  userResults: MemoryResult[];
  projectResults: MemoryResult[];
  maxProfileItems: number;
}): string {
  const parts: string[] = [];
  const { profile, userResults, projectResults, maxProfileItems } = options;

  if (profile && (profile.static.length > 0 || profile.dynamic.length > 0)) {
    parts.push("User Profile:");
    for (const line of profile.static.slice(0, maxProfileItems)) {
      parts.push(`- ${line}`);
    }
    for (const line of profile.dynamic.slice(0, maxProfileItems)) {
      parts.push(`- ${line}`);
    }
  }

  if (projectResults.length > 0) {
    parts.push("\nProject Knowledge:");
    for (const memory of projectResults) {
      const content = memory.memory || memory.chunk || memory.content || memory.summary || "";
      if (content) parts.push(`- ${content}`);
    }
  }

  if (userResults.length > 0) {
    parts.push("\nRelevant Memories:");
    for (const memory of userResults) {
      const similarity = Math.round((memory.similarity ?? 0) * 100);
      const content = memory.memory || memory.chunk || memory.content || "";
      if (content) parts.push(`- [${similarity}%] ${content}`);
    }
  }

  if (parts.length === 0) return "";
  return `[Supermemory — persistent memory recalled for this project]\n${parts.join("\n")}`;
}
