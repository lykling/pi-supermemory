/**
 * Minimal REST client for the Supermemory cloud API.
 *
 * Endpoints match what opencode-supermemory uses:
 *  - POST   /v3/documents        add memory
 *  - POST   /v3/documents/list   list memories
 *  - DELETE /v3/documents/{id}   delete memory
 *  - POST   /v4/search           search memories
 *  - POST   /v4/profile          user profile
 */

export interface MemoryResult {
  id?: string;
  memory?: string;
  content?: string;
  chunk?: string;
  title?: string;
  summary?: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  documents?: Array<{ id?: string; title?: string }>;
  [key: string]: unknown;
}

export interface ProfileResult {
  static: string[];
  dynamic: string[];
}

export interface SearchResponse {
  success: boolean;
  results: MemoryResult[];
  total: number;
  error?: string;
}

export interface ListResponse {
  success: boolean;
  memories: MemoryResult[];
  error?: string;
}

export interface AddResponse {
  success: boolean;
  id?: string;
  error?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let id: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id!)) as Promise<T>;
}

export class SupermemoryClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, baseUrl = "https://api.supermemory.ai", timeoutMs = 8000) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  private async request(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Supermemory API ${response.status}: ${body.slice(0, 300)}`);
      }
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async addMemory(
    content: string,
    containerTag: string,
    metadata: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AddResponse> {
    try {
      const result = (await withTimeout(
        this.request(
          "/v3/documents",
          {
            method: "POST",
            body: JSON.stringify({ content, containerTag, metadata }),
          },
          signal,
        ),
        this.timeoutMs,
      )) as { id?: string };
      return { success: true, id: result?.id };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async searchMemories(
    query: string,
    containerTag: string,
    options?: {
      threshold?: number;
      limit?: number;
      filters?: unknown;
      signal?: AbortSignal;
    },
  ): Promise<SearchResponse> {
    try {
      const body = {
        q: query,
        containerTag,
        threshold: options?.threshold ?? 0.6,
        limit: options?.limit ?? 5,
        searchMode: "hybrid",
        ...(options?.filters ? { filters: options.filters } : {}),
      };
      const result = (await withTimeout(
        this.request("/v4/search", { method: "POST", body: JSON.stringify(body) }, options?.signal),
        this.timeoutMs,
      )) as { results?: MemoryResult[]; total?: number };
      return {
        success: true,
        results: Array.isArray(result?.results) ? result.results : [],
        total: result?.total ?? 0,
      };
    } catch (error) {
      return {
        success: false,
        results: [],
        total: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listMemories(
    containerTag: string,
    limit = 20,
    filters?: unknown,
    signal?: AbortSignal,
  ): Promise<ListResponse> {
    try {
      const body = {
        containerTags: [containerTag],
        limit,
        order: "desc",
        sort: "createdAt",
        includeContent: true,
        ...(filters ? { filters } : {}),
      };
      const result = (await withTimeout(
        this.request("/v3/documents/list", { method: "POST", body: JSON.stringify(body) }, signal),
        this.timeoutMs,
      )) as { memories?: MemoryResult[]; documents?: MemoryResult[] };
      const memories = Array.isArray(result?.memories)
        ? result.memories
        : Array.isArray(result?.documents)
          ? result.documents
          : [];
      return { success: true, memories };
    } catch (error) {
      return {
        success: false,
        memories: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteMemory(memoryId: string, signal?: AbortSignal): Promise<{ success: boolean; error?: string }> {
    try {
      await withTimeout(
        this.request(`/v3/documents/${encodeURIComponent(memoryId)}`, { method: "DELETE" }, signal),
        this.timeoutMs,
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getProfile(
    containerTag: string,
    query?: string,
    filters?: unknown,
    signal?: AbortSignal,
  ): Promise<{ success: boolean; profile: ProfileResult; error?: string }> {
    try {
      const body = {
        containerTag,
        ...(query ? { q: query } : {}),
        ...(filters ? { filters } : {}),
      };
      const result = (await withTimeout(
        this.request("/v4/profile", { method: "POST", body: JSON.stringify(body) }, signal),
        this.timeoutMs,
      )) as {
        profile?: { static?: unknown[]; dynamic?: unknown[] };
      };
      const toLines = (items: unknown[] | undefined): string[] =>
        (items ?? [])
          .map((item) =>
            typeof item === "string"
              ? item
              : ((item as Record<string, unknown>)?.content as string | undefined) ??
                ((item as Record<string, unknown>)?.text as string | undefined) ??
                JSON.stringify(item),
          )
          .filter((line): line is string => Boolean(line?.trim()));
      return {
        success: true,
        profile: {
          static: toLines(result?.profile?.static),
          dynamic: toLines(result?.profile?.dynamic),
        },
      };
    } catch (error) {
      return {
        success: false,
        profile: { static: [], dynamic: [] },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
