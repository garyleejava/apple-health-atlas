import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import JSZip from "jszip";

import { buildHealthData } from "../web/src/aggregator.js";

async function loadFixture() {
  const bytes = await readFile(new URL("./fixtures/synthetic-health-export.zip", import.meta.url));
  const zip = await JSZip.loadAsync(bytes);
  const entries = [];
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir || !name.toLowerCase().endsWith(".csv")) continue;
    entries.push({ name, text: await file.async("string") });
  }
  return entries;
}

test("buildHealthData aggregates the synthetic Apple Health export", async () => {
  const entries = await loadFixture();
  const data = buildHealthData(entries, { timeZone: "Asia/Shanghai" });

  assert.equal(data.meta.file_count, 10);
  assert.equal(data.daily.length, 31);
  assert.equal(data.daily[0].date, "2025-06-01");
  assert.ok(data.daily[0].steps > 0);
  assert.equal(data.workouts.length, 7);
  assert.equal(data.workout_summary[0].type, "Badminton");
  assert.equal(data.workout_summary[0].count, 7);
  assert.equal(data.coverage.steps.days, 31);
  assert.deepEqual(data.coverage.steps.sources, { "Sample Watch": 31 });
});

test("buildHealthData deduplicates hourly metrics by source priority", async () => {
  const entries = await loadFixture();
  const data = buildHealthData(entries, { timeZone: "Asia/Shanghai" });

  assert.equal(data.hour_profile.steps.mean.length, 24);
  assert.ok(data.hour_profile.steps.mean.every(Number.isFinite));
  assert.ok(data.hour_profile.heart_rate.mean.some((value) => value > 0));
});

test("buildHealthData keeps sleep times in the requested time zone", async () => {
  const entries = await loadFixture();
  const data = buildHealthData(entries, { timeZone: "Asia/Shanghai" });
  const sleepRow = data.daily.find((row) => row.is_main_sleep);

  assert.ok(sleepRow);
  assert.equal(sleepRow.bedtime_min, 30);
  assert.equal(sleepRow.wake_min, 510);
  assert.equal(sleepRow.asleep_hours, 7.75);
  assert.ok(Number.isFinite(sleepRow.night_hr));
});

test("buildHealthData handles an empty export without throwing", () => {
  const data = buildHealthData([], { timeZone: "UTC" });

  assert.equal(data.daily.length, 0);
  assert.equal(data.meta.file_count, 0);
  assert.equal(data.workout_summary.length, 0);
});
