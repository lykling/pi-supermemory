import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  getGeneratedProjectTag,
  getScopeFilters,
  normalizeGitRemote,
  sanitizeRepoName,
  sha256Short,
} from "../src/tags.ts";
import { stripJsoncComments } from "../src/config.ts";
import { isFullyPrivate, stripPrivateContent } from "../src/privacy.ts";

test("sha256Short returns 16 lowercase hex chars", () => {
  const hash = sha256Short("github.com/lykling/tianshu");
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.equal(hash, sha256Short("github.com/lykling/tianshu"));
});

test("normalizeGitRemote handles https, ssh and scp-style urls", () => {
  assert.equal(normalizeGitRemote("https://github.com/lykling/tianshu.git"), "github.com/lykling/tianshu");
  assert.equal(normalizeGitRemote("ssh://git@github.com/lykling/tianshu.git"), "github.com/lykling/tianshu");
  assert.equal(normalizeGitRemote("git@github.com:lykling/tianshu.git"), "github.com/lykling/tianshu");
  assert.equal(normalizeGitRemote("https://gitlab.com:8443/group/repo/"), "gitlab.com:8443/group/repo");
});

test("sanitizeRepoName lowercases and collapses separators", () => {
  assert.equal(sanitizeRepoName("My-Cool.Repo_2"), "my_cool_repo_2");
  assert.equal(sanitizeRepoName("---"), "unknown");
  const long = sanitizeRepoName("a".repeat(200));
  assert.ok(long.length <= 95);
});

test("getGeneratedProjectTag falls back to path identity outside git", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-supermemory-test-"));
  try {
    const tag = getGeneratedProjectTag(dir);
    assert.match(tag, /^repo_pi_supermemory_test_[0-9a-z]*__[0-9a-f]{16}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getScopeFilters matches the opencode sm_scope filter shape", () => {
  assert.deepEqual(getScopeFilters("personal"), {
    AND: [{ key: "sm_scope", value: "personal", filterType: "metadata" }],
  });
});

test("stripJsoncComments removes comments and trailing commas", () => {
  const input = `{
    // api key
    "apiKey": "sm_test", /* block */
    "nested": { "a": 1, },
  }`;
  assert.deepEqual(JSON.parse(stripJsoncComments(input)), {
    apiKey: "sm_test",
    nested: { a: 1 },
  });
});

test("privacy helpers redact private blocks", () => {
  assert.equal(stripPrivateContent("keep <private>secret</private> tail"), "keep [REDACTED] tail");
  assert.equal(isFullyPrivate("<private>all secret</private>"), true);
  assert.equal(isFullyPrivate("normal text"), false);
});
