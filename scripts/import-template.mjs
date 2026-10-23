#!/usr/bin/env node
// Import a flow template YAML into DevFlow (config-as-code, plan §10 2D).
//
//   node scripts/import-template.mjs docs/flow-templates/sdlc-loop.yaml
//   node scripts/import-template.mjs my-flow.yaml --name-prefix "Team"
//
// The server must be running (DEVFLOW_URL overrides http://localhost:3000).
import fs from "node:fs";

const base = process.env.DEVFLOW_URL ?? "http://localhost:3000";
const file = process.argv[2];
const argv = process.argv.slice(3);
let namePrefix;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--name-prefix") namePrefix = argv[i + 1];
}

if (!file) {
  console.error("usage: node scripts/import-template.mjs <flow-template.yaml> [--name-prefix X]");
  process.exit(1);
}

let yaml;
try {
  yaml = fs.readFileSync(file, "utf8");
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(1);
}

const res = await fetch(`${base}/api/templates/import`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ yaml, namePrefix }),
});
const data = await res.json();
if (!res.ok) {
  console.error(`import failed: ${data.error}`);
  process.exit(1);
}
console.log(`imported "${data.name}" as template ${data.id}`);
if (data.createdNodeTemplateIds?.length) {
  console.log(`created ${data.createdNodeTemplateIds.length} declarative node template(s)`);
}
console.log(`edit it at ${base}/templates/${data.id}`);
