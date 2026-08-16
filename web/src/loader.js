import { buildHealthData } from "./aggregator.js";
import { parseCsvBytes } from "./parser.js";

export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export async function analyzeZipFile(file, options = {}) {
  if (!file) {
    throw new Error("No file was provided.");
  }

  const zipLibrary = options.JSZip || globalThis.JSZip;
  if (!zipLibrary) {
    throw new Error("JSZip was not loaded.");
  }

  const zip = await zipLibrary.loadAsync(file);
  const csvNames = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir && /\.csv$/i.test(name))
    .sort();
  if (!csvNames.length) {
    throw new Error("No CSV files were found in this ZIP.");
  }

  const entries = [];
  for (const [index, name] of csvNames.entries()) {
    const zipEntry = zip.file(name);
    const uncompressedSize = zipEntry._data?.uncompressedSize || 0;
    if (uncompressedSize > 64 * 1024 * 1024) {
      const bytes = await zipEntry.async("uint8array");
      entries.push({ name, rows: parseCsvBytes(bytes) });
    } else {
      const text = await zipEntry.async("string");
      entries.push({ name, text });
    }
    options.onProgress?.({
      current: index + 1,
      total: csvNames.length,
      metric: name,
    });
  }

  return buildHealthData(entries, {
    timeZone: options.timeZone || localTimeZone(),
    onProgress: options.onProgress,
  });
}
