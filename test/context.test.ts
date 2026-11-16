import assert from "node:assert/strict";
import { test } from "node:test";
import type { MemoryResult } from "../src/api.ts";
import { formatMemoryContext, memoryId, relativeAge } from "../src/context.ts";

const NOW = Date.parse("2026-11-20T12:00:00Z");

function memory(overrides: Partial<MemoryResult> = {}): MemoryResult {
  return {
    id: "mem_1",
    memory: "tailscale subnet router fixed via fw4 forwarding rules",
    similarity: 0.8,
    createdAt: "2026-11-17T12:00:00Z",
    ...overrides,
  };
}

test("relativeAge labels days, months and years", () => {
  assert.equal(relativeAge("2026-11-20T12:00:00Z", NOW), "today");
  assert.equal(relativeAge("2026-11-19T12:00:00Z", NOW), "yesterday");
  assert.equal(relativeAge("2026-11-15T12:00:00Z", NOW), "5d ago");
  assert.equal(relativeAge("2026-09-01T12:00:00Z", NOW), "2mo ago");
  assert.equal(relativeAge("2025-01-01T12:00:00Z", NOW), "1y ago");
  assert.equal(relativeAge(undefined, NOW), "");
  assert.equal(relativeAge("not-a-date", NOW), "");
});

test("memoryId prefers documents[0].id over chunk id", () => {
  assert.equal(memoryId(memory({ id: "chunk_9", documents: [{ id: "doc_1" }] })), "doc_1");
  assert.equal(memoryId(memory()), "mem_1");
  assert.equal(memoryId({}), "");
});

test("formatMemoryContext renders snapshot with age and relevant with scope", () => {
  const content = formatMemoryContext({
    profile: { static: ["prefers concise replies"], dynamic: [] },
    snapshot: [memory()],
    relevant: [{ memory: memory({ id: "mem_2", memory: "npm 2FA needs passkey", similarity: 0.9 }), scope: "personal" }],
    maxProfileItems: 5,
    maxContextChars: 4000,
    now: NOW,
  });
  assert.match(content, /\[Supermemory — persistent memory recalled/);
  assert.match(content, /User Profile:\n- prefers concise replies/);
  assert.match(content, /Recent Project Snapshot \(latest first\):\n- \[3d ago\] tailscale/);
  assert.match(content, /Relevant Memories:\n- \[personal, 90%\] npm 2FA needs passkey/);
});

test("formatMemoryContext drops relevant entries already in the snapshot", () => {
  const shared = memory();
  const content = formatMemoryContext({
    profile: null,
    snapshot: [shared],
    relevant: [{ memory: shared, scope: "project" }],
    maxProfileItems: 5,
    maxContextChars: 4000,
    now: NOW,
  });
  assert.match(content, /Recent Project Snapshot/);
  assert.doesNotMatch(content, /Relevant Memories/);
});

test("formatMemoryContext respects the character budget", () => {
  const long = memory({ memory: "x".repeat(500) });
  const content = formatMemoryContext({
    profile: null,
    snapshot: [long, long, long],
    relevant: [],
    maxProfileItems: 5,
    maxContextChars: 900,
  });
  assert.ok(content.length <= 900);
  // First snapshot entry fits, later ones are dropped whole, never truncated mid-line.
  assert.equal((content.match(/x{500}/g) ?? []).length, 1);
});

test("formatMemoryContext returns empty string without content", () => {
  assert.equal(
    formatMemoryContext({
      profile: null,
      snapshot: [],
      relevant: [],
      maxProfileItems: 5,
      maxContextChars: 4000,
    }),
    "",
  );
});
