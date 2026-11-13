import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";

/**
 * Container-tag derivation, ported 1:1 from opencode-supermemory so pi and
 * opencode share the same Supermemory container for the same repository.
 */

const repoInfoCache = new Map<string, { name: string | null; normalizedRemote: string | null }>();

function git(command: string, cwd: string): string | null {
  try {
    return execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/** First 16 hex chars of sha256 — matches supermemory's tag hashing. */
export function sha256Short(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/** Root of the git worktree/repo, accounting for worktrees sharing a common dir. */
export function getGitRoot(directory: string): string | null {
  const isolateWorktrees = process.env.SUPERMEMORY_ISOLATE_WORKTREES === "true";
  try {
    if (isolateWorktrees) {
      return git("git rev-parse --show-toplevel", directory) || null;
    }
    const gitCommonDir = git("git rev-parse --git-common-dir", directory);
    if (!gitCommonDir) return null;
    if (gitCommonDir === ".git") {
      return git("git rev-parse --show-toplevel", directory) || null;
    }
    const resolved = resolve(directory, gitCommonDir);
    if (basename(resolved) === ".git" && !resolved.includes(`${sep}.git${sep}`)) {
      return dirname(resolved);
    }
    return git("git rev-parse --show-toplevel", directory) || null;
  } catch {
    return null;
  }
}

export function getProjectBasePath(directory: string): string {
  return getGitRoot(directory) || resolve(directory);
}

/** Normalize a git remote URL to a stable lowercase identity string. */
export function normalizeGitRemote(remoteUrl: string): string | null {
  const raw = remoteUrl.trim();
  if (!raw) return null;
  let normalized: string;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      normalized =
        parsed.protocol === "file:"
          ? `file:${decodeURIComponent(parsed.pathname)}`
          : `${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}/${parsed.pathname.replace(/^\/+/, "")}`;
    } catch {
      normalized = raw;
    }
  } else {
    const scpStyle = raw.match(/^(?:[^@/]+@)?([^:]+):(.+)$/);
    normalized =
      scpStyle?.[1] && scpStyle?.[2]
        ? `${scpStyle[1].toLowerCase()}/${scpStyle[2]}`
        : `file:${resolve(raw)}`;
  }
  return normalized
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
}

export function getGitRepoInfo(directory: string): {
  name: string | null;
  normalizedRemote: string | null;
} {
  const cached = repoInfoCache.get(directory);
  if (cached) return cached;
  const remoteUrl = git("git remote get-url origin", directory);
  if (!remoteUrl) {
    const result = { name: null, normalizedRemote: null };
    repoInfoCache.set(directory, result);
    return result;
  }
  const normalizedRemote = normalizeGitRemote(remoteUrl);
  const displayRemote = remoteUrl.replace(/\/+$/, "").replace(/\.git$/i, "");
  const separator = Math.max(displayRemote.lastIndexOf("/"), displayRemote.lastIndexOf(":"));
  const result = {
    name: displayRemote.slice(separator + 1) || null,
    normalizedRemote,
  };
  repoInfoCache.set(directory, result);
  return result;
}

export function getGitRepoName(directory: string): string | null {
  return getGitRepoInfo(directory).name;
}

export function sanitizeRepoName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return sanitized.slice(0, 95).replace(/_+$/g, "") || "unknown";
}

/** Stable per-repo identity: remote URL when available, otherwise local path. */
export function getProjectIdentity(directory: string): string {
  const basePath = getProjectBasePath(directory);
  const { normalizedRemote } = getGitRepoInfo(basePath);
  const isolateWorktrees = process.env.SUPERMEMORY_ISOLATE_WORKTREES === "true";
  let localIdentity = basePath;
  try {
    localIdentity = realpathSync.native(basePath);
  } catch {
    // keep basePath
  }
  return sha256Short(!isolateWorktrees && normalizedRemote ? normalizedRemote : `path:${localIdentity}`);
}

/** Generated tag: repo_<name>__<identity-hash>. */
export function getGeneratedProjectTag(directory: string): string {
  const basePath = getProjectBasePath(directory);
  const repoName = getGitRepoName(basePath) || basename(basePath) || "unknown";
  const shortName = sanitizeRepoName(repoName).slice(0, 72).replace(/_+$/g, "");
  return `repo_${shortName || "unknown"}__${getProjectIdentity(directory)}`;
}

/** Canonical container tag for a directory, with env override. */
export function getProjectTag(directory: string): string {
  return process.env.SUPERMEMORY_REPO_TAG || getGeneratedProjectTag(directory);
}

export function getProjectName(directory: string): string {
  const basePath = getProjectBasePath(directory);
  return getGitRepoName(basePath) || basename(basePath) || "unknown";
}

/** Metadata filter for sm_scope, matching opencode-supermemory. */
export function getScopeFilters(scope: string): { AND: Array<{ key: string; value: string; filterType: string }> } {
  return { AND: [{ key: "sm_scope", value: scope, filterType: "metadata" }] };
}
