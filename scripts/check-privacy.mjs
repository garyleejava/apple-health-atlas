import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forbidden = [
  "health_data.js",
  "health_dashboard_data.json",
  "health_profile.json",
];

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile()) yield full;
  }
}

const failures = [];
for await (const file of walk(root)) {
  if (file.endsWith(".zip") && !file.includes(`${path.sep}fixtures${path.sep}`)) {
    failures.push(`${file}: non-fixture ZIP`);
    continue;
  }
  if (
    file.endsWith(".csv") ||
    file.endsWith(".parquet") ||
    file.endsWith(".duckdb") ||
    file.endsWith(".sqlite")
  ) {
    failures.push(`${file}: real health artifact`);
    continue;
  }
  if (
    !file.endsWith(".js") &&
    !file.endsWith(".mjs") &&
    !file.endsWith(".html") &&
    !file.endsWith(".md") &&
    !file.endsWith(".json") &&
    !file.endsWith(".py")
  ) {
    continue;
  }
  const text = await readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (text.includes(pattern)) {
      failures.push(`${file}: forbidden pattern ${pattern}`);
    }
  }
}

if (failures.length) {
  console.error("Privacy check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Privacy check passed");
