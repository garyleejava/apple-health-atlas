import "../vendor/jszip.min.js";
import { analyzeZipFile } from "./loader.js";

self.onmessage = async (event) => {
  try {
    const data = await analyzeZipFile(event.data, {
      onProgress: (progress) => {
        self.postMessage({ type: "progress", progress });
      },
    });
    self.postMessage({ type: "done", data });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "Unable to parse the export.",
    });
  }
};
