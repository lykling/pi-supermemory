# pi-supermemory

[Supermemory](https://supermemory.ai) persistent memory for the
[pi coding agent](https://github.com/earendil-works/pi-mono) — and it **shares
the same memory store as your opencode supermemory plugin**.

Both agents derive identical per-repo container tags (`repo_<name>__<hash>`),
so anything you told opencode to remember is recalled by pi in the same
repository, and vice versa.

## What it does

- Registers a `supermemory` tool with modes: `add`, `search`, `list`,
  `forget`, `profile`, `help` — the same interface as the opencode plugin.
- **Hybrid recall** (v0.2.0, the default `autoRecall: "hybrid"`):
  - At the first prompt of a session it injects a *small deterministic
    preload*: user profile + a recent-project snapshot (latest 3, with age
    labels) + semantic search hits for the opening prompt, within a hard
    character budget.
  - For the rest of the session, per-turn reasoned recall: the tool's prompt
    guidelines tell the model when to `search` (topic shift, references to
    past decisions) and when to skip (self-contained or trivial messages).
  - After context compaction, profile + snapshot are re-injected, because
    the session-start block does not survive summarization.
  - `add` refuses once on near-duplicates (similarity ≥ 0.9) and suggests
    `forget`-then-`add`, keeping the store from stacking stale copies.
- Redacts `<private>...</private>` blocks before sending anything to the cloud.
- Reuses your existing Supermemory credentials — zero extra setup if you
  already use opencode-supermemory.

## Install

```bash
pi install npm:@lykling/pi-supermemory
```

## Configuration

API key resolution order (first match wins):

1. `SUPERMEMORY_API_KEY` environment variable
2. `~/.pi/agent/supermemory.json` — pi-native config:
   ```json
   { "apiKey": "sm_...", "autoRecall": "full" }
   ```
3. `~/.config/opencode/supermemory.jsonc` — shared with opencode
4. `~/.supermemory-opencode/credentials.json` — opencode device-flow login

Other options:

- `SUPERMEMORY_API_BASE_URL` — override `https://api.supermemory.ai`
- `SUPERMEMORY_REPO_TAG` — force a fixed container tag
- `SUPERMEMORY_ISOLATE_WORKTREES=true` — give each git worktree its own tag
- `autoRecall` in `~/.pi/agent/supermemory.json`:
  `"hybrid"` (default; profile + recent snapshot + prompt search on both
  scopes), `"full"` (legacy eager dump), `"profile"` (profile only), or `"off"`
- Tunables in the same file: `snapshotCount` (3), `maxContextChars` (4000),
  `compactReinject` (true), `dedupeOnAdd` (true), `dedupeThreshold` (0.9),
  `similarityThreshold` (0.6), `maxMemories` (5), `maxProjectMemories` (10),
  `maxProfileItems` (5)

## The tool

| mode | args | description |
|---|---|---|
| `add` | `content`, `type?`, `scope?`, `force?` | Store a memory (`scope`: `user`/`project`, default `project`; `force: true` skips the near-duplicate check) |
| `search` | `query`, `scope?`, `limit?` | Hybrid search over memories |
| `list` | `scope?`, `limit?` | List recent memories |
| `profile` | `query?` | User profile extracted by Supermemory |
| `forget` | `memoryId` | Delete a memory |
| `help` | — | Usage guide |

## Development

```bash
npm install
npm run typecheck
npm test
```

The extension is plain TypeScript loaded by pi via jiti — no build step.

## License

MIT
