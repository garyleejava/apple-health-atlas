import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "web", "vendor");
await mkdir(vendor, { recursive: true });

await copyFile(
  path.join(root, "node_modules", "echarts", "dist", "echarts.min.js"),
  path.join(vendor, "echarts.min.js"),
);
await copyFile(
  path.join(root, "node_modules", "jszip", "dist", "jszip.min.js"),
  path.join(vendor, "jszip.min.js"),
);

console.log(`vendored dependencies -> ${vendor}`);
