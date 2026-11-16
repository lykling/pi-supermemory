import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { SupermemoryClient } from "./api.ts";
import { resolveSettings } from "./config.ts";
import { formatMemoryContext, memoryId } from "./context.ts";
import { isFullyPrivate, stripPrivateContent } from "./privacy.ts";
import { getProjectName, getProjectIdentity, getProjectTag, getScopeFilters } from "./tags.ts";

const VERSION = "0.2.0";
const PLUGIN_NAME = "@lykling/pi-supermemory";

/** Prompts shorter than this make poor semantic search queries; snapshot covers them. */
const MIN_SEARCH_PROMPT_LENGTH = 16;

/**
 * Persistent Supermemory memory for pi.
 *
 * Reuses the Supermemory cloud account already configured for opencode
 * (same API key, same per-repo container tags), so memories are shared
 * across both agents.
 *
 * Recall strategy (hybrid): small deterministic preload (profile + recent
 * snapshot) at session start, per-turn reasoned recall via the tool
 * thereafter, and re-injection after context compaction.
 */
export default function supermemoryExtension(pi: ExtensionAPI) {
  const settings = resolveSettings();
  if (!settings.apiKey) {
    // Not configured: stay silent. Set SUPERMEMORY_API_KEY or create
    // ~/.pi/agent/supermemory.json, then run /reload.
    return;
  }

  const client = new SupermemoryClient(settings.apiKey, settings.baseUrl);

  const tagsFor = (directory: string) => ({
    containerTag: getProjectTag(directory),
    projectId: getProjectIdentity(directory),
    projectName: getProjectName(directory),
  });

  pi.registerTool({
    name: "supermemory",
    label: "Supermemory",
    description:
      "Manage and query the Supermemory persistent memory system shared across coding agents and sessions. " +
      "Use 'search' to find relevant memories, 'add' to store new knowledge, 'list' to see recent memories, " +
      "'profile' to view the user profile, 'forget' to remove a memory.",
    promptSnippet: "Search, add, list, or forget persistent memories shared across sessions and agents",
    promptGuidelines: [
      "Recall discipline: before answering, silently decide whether saved memory would materially improve THIS reply. Use supermemory mode=search when starting a task that may build on earlier sessions, when the user references past decisions or preferences, or when the topic shifts to something previously discussed. Skip recall when the message is self-contained, trivial, or you already recalled this topic and it has not shifted. Fold results into your answer without narrating the search.",
      "Before storing with mode=add, search first for near-duplicates: if the tool warns about similar existing memories, forget the outdated one (mode=forget with its memoryId) and then add, instead of stacking similar entries.",
    ],
    parameters: Type.Object({
      mode: StringEnum(["add", "search", "profile", "list", "forget", "help"], {
        description: "Operation to perform (default: help)",
      }),
      content: Type.Optional(
        Type.String({ description: "Memory content to store (mode=add)" }),
      ),
      force: Type.Optional(
        Type.Boolean({
          description: "Skip the near-duplicate check (mode=add)",
        }),
      ),
      query: Type.Optional(Type.String({ description: "Search query (mode=search, mode=profile)" })),
      type: Type.Optional(
        StringEnum(
          ["project-config", "architecture", "error-solution", "preference", "learned-pattern", "conversation"],
          { description: "Memory type (mode=add)" },
        ),
      ),
      scope: Type.Optional(
        StringEnum(["user", "project"], {
          description: "user = personal preferences for this project, project = project knowledge (default)",
        }),
      ),
      memoryId: Type.Optional(Type.String({ description: "Memory id to remove (mode=forget)" })),
      limit: Type.Optional(Type.Number({ description: "Max results (mode=search, mode=list)" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const mode = params.mode ?? "help";
      const tags = tagsFor(ctx.cwd);

      try {
        switch (mode) {
          case "add": {
            if (!params.content) {
              return text({ success: false, error: "content parameter is required for add mode" });
            }
            if (isFullyPrivate(params.content)) {
              return text({ success: false, error: "Cannot store fully private content" });
            }
            if (settings.dedupeOnAdd && !params.force) {
              const dup = await client.searchMemories(params.content, tags.containerTag, {
                threshold: settings.dedupeThreshold,
                limit: 3,
                signal,
              });
              if (dup.success && dup.results.length > 0) {
                return text({
                  success: false,
                  duplicate: true,
                  message:
                    "Highly similar memories already exist. If the new content supersedes them, " +
                    "call forget with each memoryId below and then add again; to store anyway, " +
                    "retry add with force=true.",
                  similar: dup.results.map((m) => ({
                    id: memoryId(m),
                    similarity: m.similarity,
                    content: (m.memory || m.chunk || m.content || m.summary || "").slice(0, 200),
                  })),
                });
              }
            }
            const scope = params.scope ?? "project";
            const internalScope = scope === "user" ? "personal" : "project";
            const result = await client.addMemory(
              stripPrivateContent(params.content),
              tags.containerTag,
              {
                type: params.type,
                project: tags.projectName,
                sm_project_id: tags.projectId,
                sm_scope: internalScope,
                sm_capture_mode: "tool",
                sm_source: "pi",
                sm_client: PLUGIN_NAME,
                sm_plugin_version: VERSION,
              },
              signal,
            );
            if (!result.success) {
              return text({ success: false, error: result.error || "Failed to add memory" });
            }
            return text({
              success: true,
              message: `Memory added to ${scope} scope`,
              id: result.id,
              scope,
              type: params.type,
            });
          }

          case "search": {
            if (!params.query) {
              return text({ success: false, error: "query parameter is required for search mode" });
            }
            const filters = params.scope
              ? getScopeFilters(params.scope === "user" ? "personal" : "project")
              : undefined;
            const result = await client.searchMemories(params.query, tags.containerTag, {
              threshold: settings.similarityThreshold,
              limit: params.limit ?? settings.maxMemories,
              filters,
              signal,
            });
            if (!result.success) {
              return text({ success: false, error: result.error || "Search failed" });
            }
            return text({
              success: true,
              query: params.query,
              scope: params.scope,
              results: result.results.map((m) => ({
                // Top-level id is a chunk id; the deletable memory id lives in documents[0].
                id: m.documents?.[0]?.id ?? m.id,
                content: m.memory || m.chunk || m.content || "",
                title: m.title,
                similarity: m.similarity,
                metadata: m.metadata,
              })),
              total: result.total,
            });
          }

          case "list": {
            const filters = params.scope
              ? getScopeFilters(params.scope === "user" ? "personal" : "project")
              : undefined;
            const result = await client.listMemories(
              tags.containerTag,
              params.limit ?? 20,
              filters,
              signal,
            );
            if (!result.success) {
              return text({ success: false, error: result.error || "List failed" });
            }
            return text({
              success: true,
              memories: result.memories.map((m) => ({
                id: m.id,
                content: m.summary || m.content || m.title || "",
                metadata: m.metadata,
                createdAt: m.createdAt,
              })),
              containerTag: tags.containerTag,
            });
          }

          case "forget": {
            if (!params.memoryId) {
              return text({ success: false, error: "memoryId parameter is required for forget mode" });
            }
            const result = await client.deleteMemory(params.memoryId, signal);
            if (!result.success) {
              return text({ success: false, error: result.error || "Failed to delete memory" });
            }
            return text({ success: true, message: `Memory ${params.memoryId} deleted` });
          }

          case "profile": {
            const filters = params.scope
              ? getScopeFilters(params.scope === "user" ? "personal" : "project")
              : undefined;
            const result = await client.getProfile(
              tags.containerTag,
              params.query,
              filters,
              signal,
            );
            if (!result.success) {
              return text({ success: false, error: result.error || "Failed to load profile" });
            }
            return text({ success: true, profile: result.profile });
          }

          case "help":
          default:
            return text({
              success: true,
              message: "Supermemory Usage Guide (shared with opencode)",
              commands: [
                { command: "add", description: "Store a new memory", args: ["content", "type?", "scope?", "force?"] },
                { command: "search", description: "Search memories", args: ["query", "scope?", "limit?"] },
                { command: "profile", description: "View user profile", args: ["query?"] },
                { command: "list", description: "List recent memories", args: ["scope?", "limit?"] },
                { command: "forget", description: "Remove a memory", args: ["memoryId"] },
              ],
              scopes: {
                user: "Personal preferences and knowledge for this project",
                project: "Project-specific knowledge (default)",
              },
              containerTag: tags.containerTag,
            });
        }
      } catch (error) {
        return text({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // Recall memories on the first prompt of each session.
  const injectedSessions = new Set<string>();

  pi.on("before_agent_start", async (event, ctx) => {
    if (settings.autoRecall === "off") return;
    const sessionId = ctx.sessionManager.getSessionId();
    if (!sessionId || injectedSessions.has(sessionId)) return;
    injectedSessions.add(sessionId);

    try {
      const tag = getProjectTag(ctx.cwd);
      const prompt =
        event.messageType === "user" ? (event as { prompt: string }).prompt : "";
      // Short openers ("continue") are poor queries; the snapshot covers them.
      const searchable = prompt.trim().length >= MIN_SEARCH_PROMPT_LENGTH;

      let profileResult: Awaited<ReturnType<typeof client.getProfile>>;
      let snapshotResult: Awaited<ReturnType<typeof client.listMemories>> | null = null;
      let projectSearchResult: Awaited<ReturnType<typeof client.searchMemories>> | null = null;
      let personalSearchResult: Awaited<ReturnType<typeof client.searchMemories>> | null = null;

      if (settings.autoRecall === "profile") {
        profileResult = await client.getProfile(tag);
      } else if (settings.autoRecall === "full") {
        [profileResult, snapshotResult, personalSearchResult] = await Promise.all([
          client.getProfile(tag),
          client.listMemories(tag, settings.maxProjectMemories, getScopeFilters("project")),
          searchable
            ? client.searchMemories(prompt, tag, {
                threshold: settings.similarityThreshold,
                limit: settings.maxMemories,
                filters: getScopeFilters("personal"),
              })
            : Promise.resolve(null),
        ]);
      } else {
        // hybrid (default): profile + small recent snapshot + semantic search on both scopes.
        [profileResult, snapshotResult, projectSearchResult, personalSearchResult] = await Promise.all([
          client.getProfile(tag, undefined, getScopeFilters("personal")),
          client.listMemories(tag, settings.snapshotCount, getScopeFilters("project")),
          searchable
            ? client.searchMemories(prompt, tag, {
                threshold: settings.similarityThreshold,
                limit: settings.maxMemories,
                filters: getScopeFilters("project"),
              })
            : Promise.resolve(null),
          searchable
            ? client.searchMemories(prompt, tag, {
                threshold: settings.similarityThreshold,
                limit: 3,
                filters: getScopeFilters("personal"),
              })
            : Promise.resolve(null),
        ]);
      }

      const relevant: Array<{ memory: NonNullable<typeof projectSearchResult>["results"][number]; scope: "project" | "personal" }> = [];
      for (const memory of projectSearchResult?.results ?? []) {
        relevant.push({ memory, scope: "project" });
      }
      for (const memory of personalSearchResult?.results ?? []) {
        relevant.push({ memory, scope: "personal" });
      }

      const content = formatMemoryContext({
        profile: profileResult.success ? profileResult.profile : null,
        snapshot: snapshotResult?.memories ?? [],
        relevant,
        maxProfileItems: settings.maxProfileItems,
        maxContextChars: settings.maxContextChars,
      });
      if (!content) return;

      const snapshotCount = snapshotResult?.memories.length ?? 0;
      const relevantCount = relevant.length;
      ctx.ui.notify(
        `Supermemory: recalled ${snapshotCount} snapshot / ${relevantCount} relevant memories`,
        "info",
      );
      return {
        message: {
          customType: "supermemory-recall",
          content,
          display: true,
        },
      };
    } catch {
      // Recall must never break the turn.
    }
  });

  // Compaction washes out the session-start injection; re-inject the
  // deterministic parts (profile + recent snapshot) so memory survives.
  pi.on("session_compact", async (event, ctx) => {
    if (!settings.compactReinject || settings.autoRecall === "off") return;
    void event;
    try {
      const tag = getProjectTag(ctx.cwd);
      const [profileResult, snapshotResult] = await Promise.all([
        client.getProfile(tag, undefined, getScopeFilters("personal")),
        client.listMemories(tag, settings.snapshotCount, getScopeFilters("project")),
      ]);
      const content = formatMemoryContext({
        profile: profileResult.success ? profileResult.profile : null,
        snapshot: snapshotResult?.memories ?? [],
        relevant: [],
        maxProfileItems: settings.maxProfileItems,
        maxContextChars: settings.maxContextChars,
      });
      if (!content) return;
      pi.sendMessage({
        customType: "supermemory-recall",
        content,
        display: true,
      });
    } catch {
      // Re-injection must never break the session.
    }
  });
}

function text(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value as Record<string, unknown>,
  };
}
