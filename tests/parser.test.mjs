import test from "node:test";
import assert from "node:assert/strict";

import {
  metricFromFileName,
  parseCsvBytes,
  parseCsvRows,
  parseDate,
  parseNumber,
} from "../web/src/parser.js";

test("parseCsvRows skips a quoted sep=, declaration", () => {
  const rows = [...parseCsvRows('"sep=,"\r\ntype,sourceName,value\r\nHKType,"Watch,1",12\r\n')];

  assert.deepEqual(rows, [
    { type: "HKType", sourceName: "Watch,1", value: "12" },
  ]);
});

test("parseCsvRows handles escaped quotes and a UTF-8 BOM", () => {
  const rows = [...parseCsvRows('\uFEFFsep=,\r\nname,note\r\nWatch,"said ""hello"""\r\n')];

  assert.equal(rows[0].name, "Watch");
  assert.equal(rows[0].note, 'said "hello"');
});

test("parseCsvBytes streams across multibyte chunk boundaries", () => {
  const rows = [...parseCsvBytes(
    new TextEncoder().encode("sep=,\r\ntype,value\r\nA,1\r\nB,2\r\n"),
    3,
  )];

  assert.deepEqual(rows, [
    { type: "A", value: "1" },
    { type: "B", value: "2" },
  ]);
});

test("parseDate accepts Apple Health offsets", () => {
  const parsed = parseDate("2025-06-01 00:14:00 +0800");

  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getTime(), Date.parse("2025-05-31T16:14:00Z"));
});

test("parseNumber returns the numeric prefix", () => {
  assert.equal(parseNumber("12,345 steps"), 12345);
  assert.equal(parseNumber("83 dBASPL"), 83);
  assert.equal(parseNumber(""), null);
});

test("metricFromFileName extracts common Apple Health metric names", () => {
  assert.equal(
    metricFromFileName("HKQuantityTypeIdentifierStepCount_2025-01-01.csv"),
    "StepCount",
  );
  assert.equal(
    metricFromFileName("HKCategoryTypeIdentifierSleepAnalysis_2025-01-01.csv"),
    "SleepAnalysis",
  );
  assert.equal(
    metricFromFileName("HKWorkoutActivityTypeBadminton_2025-01-01.csv"),
    "Badminton",
  );
});
