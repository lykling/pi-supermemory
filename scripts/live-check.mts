/**
 * Live check against the Supermemory API using resolved credentials.
 * Usage: node scripts/live-check.mts [directory]
 */
import { SupermemoryClient } from "../src/api.ts";
import { resolveSettings } from "../src/config.ts";
import { getProjectName, getProjectTag } from "../src/tags.ts";

const settings = resolveSettings();
const directory = process.argv[2] ?? process.cwd();

console.log("apiKey found:", settings.apiKey ? `sm_...${settings.apiKey.slice(-6)}` : "NO");
console.log("baseUrl:", settings.baseUrl);
console.log("directory:", directory);
console.log("projectName:", getProjectName(directory));
console.log("containerTag:", getProjectTag(directory));

if (!settings.apiKey) process.exit(1);
const client = new SupermemoryClient(settings.apiKey, settings.baseUrl);
const tag = getProjectTag(directory);

console.log("\n--- list (project scope) ---");
const list = await client.listMemories(tag, 5, { AND: [{ key: "sm_scope", value: "project", filterType: "metadata" }] });
console.log(JSON.stringify(list, null, 2).slice(0, 1200));

console.log("\n--- search ---");
const search = await client.searchMemories("project architecture", tag, { limit: 3 });
console.log(JSON.stringify(search, null, 2).slice(0, 1200));

console.log("\n--- add + forget roundtrip ---");
const add = await client.addMemory(
  "live-check from pi-supermemory (safe to delete)",
  tag,
  { sm_source: "pi", sm_client: "live-check", sm_scope: "project", sm_capture_mode: "tool" },
);
console.log(JSON.stringify(add));
if (add.success && add.id) {
  const del = await client.deleteMemory(add.id);
  console.log("forget:", JSON.stringify(del));
}
