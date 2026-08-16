const METRIC_PATTERN =
  /^HK(?:QuantityTypeIdentifier|CategoryTypeIdentifier|WorkoutActivityType)([^_]+)_/;

export const SUM_METRICS = {
  ActiveEnergyBurned: "active_energy",
  BasalEnergyBurned: "basal_energy",
  StepCount: "steps",
  DistanceWalkingRunning: "distance_wr",
  DistanceCycling: "distance_cycling",
  FlightsClimbed: "flights",
  AppleExerciseTime: "exercise_min",
  AppleStandTime: "stand_min",
};

export const AVG_METRICS = {
  RestingHeartRate: "resting_hr",
  HeartRateVariabilitySDNN: "hrv",
  RespiratoryRate: "respiratory_rate",
  OxygenSaturation: "oxygen",
  WalkingHeartRateAverage: "walking_hr",
  VO2Max: "vo2max",
  AppleSleepingWristTemperature: "wrist_temp",
  EnvironmentalAudioExposure: "environmental_db",
  HeadphoneAudioExposure: "headphone_db",
  StairAscentSpeed: "stair_ascent",
  StairDescentSpeed: "stair_descent",
  WalkingSpeed: "walking_speed",
  WalkingStepLength: "step_length",
  WalkingAsymmetryPercentage: "asymmetry",
  WalkingDoubleSupportPercentage: "double_support",
  AppleWalkingSteadiness: "walking_steadiness",
};

export const POINT_METRICS = new Set([
  "BodyMass",
  "BodyMassIndex",
  "Height",
  "BloodPressureDiastolic",
  "BloodPressureSystolic",
  "ForcedVitalCapacity",
  "NikeFuel",
  "SixMinuteWalkTestDistance",
  "HeartRateRecoveryOneMinute",
  "VO2Max",
]);

export const WORKOUT_METRICS = new Set([
  "Cycling",
  "FunctionalStrengthTraining",
  "HighIntensityIntervalTraining",
  "MixedMetabolicCardioTraining",
  "Running",
  "Walking",
  "Badminton",
]);

export const SOURCE_PRIORITY = {
  steps: ["Apple Watch", "Huawei Health", "Zepp Life", "iPhone"],
  active_energy: ["Apple Watch", "Huawei Health", "Zepp Life", "iPhone"],
  basal_energy: ["Apple Watch", "iPhone"],
  distance_wr: ["Apple Watch", "Huawei Health", "iPhone"],
  distance_cycling: ["Apple Watch"],
  flights: ["iPhone", "Apple Watch"],
  exercise_min: ["Apple Watch"],
  stand_min: ["Apple Watch"],
  heart_rate: ["Apple Watch", "Huawei Health", "Zepp Life", "iPhone"],
  resting_hr: ["Apple Watch", "Huawei Health", "iPhone"],
  hrv: ["Apple Watch"],
  respiratory_rate: ["Apple Watch"],
  oxygen: ["Apple Watch"],
  walking_hr: ["Apple Watch"],
  vo2max: ["Apple Watch"],
  wrist_temp: ["Apple Watch"],
  environmental_db: ["Apple Watch"],
  headphone_db: ["iPhone"],
  stair_ascent: ["Apple Watch"],
  stair_descent: ["Apple Watch"],
  walking_speed: ["iPhone"],
  step_length: ["iPhone"],
  asymmetry: ["iPhone"],
  double_support: ["iPhone"],
  walking_steadiness: ["iPhone"],
};

export const SLEEP_PRIORITY = [
  "Apple Watch",
  "Zepp Life",
  "Huawei Health",
  "iPhone",
  "Clock",
  "Health",
];

export function metricFromFileName(name) {
  const match = METRIC_PATTERN.exec(name);
  return match ? match[1] : name.replace(/\.csv$/i, "");
}

export function isWorkoutFile(name) {
  return /^HKWorkoutActivityType/i.test(name);
}

export function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text
    .replace(" ", "T")
    .replace(/\s([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseNumber(value) {
  if (value == null) return null;
  const match = /-?\d+(?:\.\d+)?/.exec(String(value).replaceAll(",", ""));
  return match ? Number(match[0]) : null;
}

function parseCsvLine(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      out.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  out.push(field);
  return out;
}

export function* parseCsvRows(text) {
  let source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstBreak = source.search(/\r?\n/);
  const firstLine = source.slice(0, firstBreak).trim();
  if (firstBreak !== -1 && firstLine.replace(/^"|"$/g, "") === "sep=,") {
    const lineBreakLength = source[firstBreak] === "\r" ? 2 : 1;
    source = source.slice(firstBreak + lineBreakLength);
  }

  const lines = source.split(/\r?\n/);
  if (!lines.length) return;
  const headers = parseCsvLine(lines[0]);
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    const row = {};
    for (let column = 0; column < headers.length; column += 1) {
      row[headers[column]] = values[column] ?? "";
    }
    yield row;
  }
}

export function* parseCsvBytes(bytes, chunkSize = 1024 * 1024) {
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  let headers = null;
  let offset = 0;

  const parseLine = function* (line) {
    if (!line.trim()) return;
    if (!headers) {
      if (line.trim().replace(/^"|"$/g, "") === "sep=,") return;
      headers = parseCsvLine(line);
      return;
    }
    const values = parseCsvLine(line);
    const row = {};
    for (let column = 0; column < headers.length; column += 1) {
      row[headers[column]] = values[column] ?? "";
    }
    yield row;
  };

  while (offset < bytes.length) {
    const chunk = decoder.decode(bytes.subarray(offset, offset + chunkSize), {
      stream: true,
    });
    offset += Math.min(chunkSize, bytes.length - offset);
    const lines = (pending + chunk).split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) yield* parseLine(line);
  }
  pending += decoder.decode();
  if (pending) yield* parseLine(pending);
}

export function sourceName(row) {
  return String(row.sourceName || "").trim() || "(blank)";
}

export function readZipEntries(zip) {
  return Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir && /\.csv$/i.test(name))
    .sort();
}
