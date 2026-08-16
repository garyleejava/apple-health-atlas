import {
  AVG_METRICS,
  POINT_METRICS,
  SLEEP_PRIORITY,
  SUM_METRICS,
  isWorkoutFile,
  metricFromFileName,
  parseCsvBytes,
  parseCsvRows,
  parseDate,
  parseNumber,
  sourceName,
} from "./parser.js";

const HOUR_METRICS = new Set([
  "steps",
  "active_energy",
  "distance_wr",
  "flights",
  "exercise_min",
  "stand_min",
]);

function ensureMap(map, key) {
  if (!map.has(key)) map.set(key, new Map());
  return map.get(key);
}

function sourceRank(metric, source) {
  const normalized = source.toLocaleLowerCase();
  if (normalized.includes("apple watch") || normalized.includes("watch")) return 0;
  if (normalized.includes("huawei") || normalized.includes("华为")) return 1;
  if (normalized.includes("zepp") || normalized.includes("mi fit")) return 2;
  if (normalized.includes("iphone")) return 3;
  if (normalized.includes("health")) return 4;
  if (normalized.includes("clock")) return 5;
  return 100;
}

function orderedSources(metric, available) {
  return [...available].sort((a, b) => sourceRank(metric, a) - sourceRank(metric, b));
}

function dateParts(date, timeZone) {
  const epoch = date.getTime();
  const utcDay = Math.floor(epoch / 86_400_000);
  const cacheKey = `${timeZone}|${utcDay}`;
  let zone = datePartsCache.get(cacheKey);
  if (!zone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const localAt = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour || 0),
      Number(values.minute || 0),
      Number(values.second || 0),
    );
    zone = {
      offsetMs: localAt - epoch,
      days: new Map(),
    };
    datePartsCache.set(cacheKey, zone);
  }

  const localMs = epoch + zone.offsetMs;
  const localDay = Math.floor(localMs / 86_400_000);
  let local = zone.days.get(localDay);
  if (!local) {
    local = {
      date: new Date(localDay * 86_400_000).toISOString().slice(0, 10),
    };
    zone.days.set(localDay, local);
  }
  const dayMs = localMs - localDay * 86_400_000;
  return {
    date: local.date,
    hour: Math.floor(dayMs / 3_600_000),
    minute: Math.floor((dayMs % 3_600_000) / 60_000),
  };
}

const datePartsCache = new Map();

function dateKeyOf(date, timeZone) {
  return dateParts(date, timeZone).date;
}

function parseIsoDate(key) {
  return new Date(`${key}T12:00:00Z`);
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

function pearson(pairs) {
  const rows = pairs.filter(
    ([left, right]) =>
      Number.isFinite(Number(left)) && Number.isFinite(Number(right)),
  );
  const count = rows.length;
  if (count < 3) return { n: count, r: 0 };
  const lefts = rows.map((pair) => Number(pair[0]));
  const rights = rows.map((pair) => Number(pair[1]));
  const leftMean = mean(lefts);
  const rightMean = mean(rights);
  let covariance = 0;
  let leftSd = 0;
  let rightSd = 0;
  for (let index = 0; index < count; index += 1) {
    const leftDelta = lefts[index] - leftMean;
    const rightDelta = rights[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftSd += leftDelta ** 2;
    rightSd += rightDelta ** 2;
  }
  if (!leftSd || !rightSd) return { n: count, r: 0 };
  return { n: count, r: covariance / Math.sqrt(leftSd * rightSd) };
}

function histogram(values, minimum, maximum, bins) {
  if (!values.length) return [];
  const width = (maximum - minimum) / bins;
  const counts = Array(bins).fill(0);
  for (const value of values) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value - minimum) / width)));
    counts[index] += 1;
  }
  return counts.map((count, index) => ({
    label: minimum + index * width + width / 2,
    count,
  }));
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const ordered = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [ordered[0]];
  for (const interval of ordered.slice(1)) {
    const last = merged.at(-1);
    if (interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

function intervalHours(intervals) {
  return intervals.reduce(
    (sum, interval) => sum + (interval.end - interval.start) / 3_600_000,
    0,
  );
}

function minutesInZone(date, timeZone) {
  const parts = dateParts(date, timeZone);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function buildSleepCandidates(sleepRaw, timeZone) {
  const candidates = [];
  for (const [key, rows] of sleepRaw) {
    const separator = key.lastIndexOf("|");
    const source = key.slice(0, separator);
    const sleepDay = key.slice(separator + 1);
    const asleep = [];
    const inBed = [];
    const awake = [];
    const stages = { core: 0, rem: 0, deep: 0, awake: 0 };
    for (const row of rows) {
      if (row.value === "inBed") inBed.push(row);
      else if (row.value === "awake") awake.push(row);
      else if (row.value.startsWith("asleep")) {
        asleep.push(row);
        const minutes = (row.end - row.start) / 60_000;
        if (row.value === "asleepCore") stages.core += minutes;
        else if (row.value === "asleepREM") stages.rem += minutes;
        else if (row.value === "asleepDeep") stages.deep += minutes;
      }
    }
    const asleepMerged = mergeIntervals(asleep);
    const inBedMerged = mergeIntervals(inBed);
    const awakeMerged = mergeIntervals(awake);
    const bedIntervals = [...asleepMerged, ...inBedMerged];
    if (!bedIntervals.length) continue;
    const bedStart = Math.min(...bedIntervals.map((item) => item.start));
    const bedEnd = Math.max(...bedIntervals.map((item) => item.end));
    let asleepHours = intervalHours(asleepMerged);
    let inBedHours = intervalHours(inBedMerged);
    if (!asleepHours) asleepHours = Math.max(0, inBedHours - intervalHours(awakeMerged));
    if (!inBedHours) inBedHours = asleepHours;
    const main = [...(asleepMerged.length ? asleepMerged : inBedMerged)].sort(
      (a, b) => b.end - b.start - (a.end - a.start),
    )[0];
    const midpoint = bedStart + (bedEnd - bedStart) / 2;
    const start = new Date(bedStart);
    const end = new Date(bedEnd);
    const midpointDate = new Date(midpoint);
    candidates.push({
      sleepDay,
      source,
      asleepHours,
      inBedHours,
      bedStart: start,
      bedEnd: end,
      bedtimeMin: minutesInZone(start, timeZone),
      wakeMin: minutesInZone(end, timeZone),
      midpointMin: minutesInZone(midpointDate, timeZone),
      mainStart: new Date(main.start),
      mainEnd: new Date(main.end),
      ...stages,
    });
  }
  return candidates;
}

function selectSleep(candidates, timeZone) {
  const byDay = new Map();
  for (const candidate of candidates) {
    if (!byDay.has(candidate.sleepDay)) byDay.set(candidate.sleepDay, []);
    byDay.get(candidate.sleepDay).push(candidate);
  }
  const chosen = new Map();
  for (const [day, rows] of byDay) {
    const available = new Set(rows.map((row) => row.source));
    const ordered = [
      ...SLEEP_PRIORITY.filter((source) => available.has(source)),
      ...[...available].sort(),
    ];
    const selected = rows.find((row) => row.source === ordered[0]) || rows[0];
    selected.isMainSleep = Boolean(
      selected.asleepHours >= 3 &&
        selected.asleepHours <= 13.5 &&
        selected.inBedHours <= 15 &&
        selected.midpointMin >= 120 &&
        selected.midpointMin <= 600,
    );
    chosen.set(day, selected);
  }
  for (const candidate of candidates) {
    candidate.isMainSleep =
      chosen.get(candidate.sleepDay)?.source === candidate.source &&
      chosen.get(candidate.sleepDay).isMainSleep;
  }
  return chosen;
}

function nightHeartRate(sleep, hourlyHeartRate, timeZone) {
  if (!sleep.mainStart || !sleep.mainEnd) return null;
  let weighted = 0;
  let seconds = 0;
  let cursor = sleep.mainStart.getTime();
  const end = sleep.mainEnd.getTime();
  while (cursor < end) {
    const local = dateParts(new Date(cursor), timeZone);
    const key = `${local.date}|${local.hour}`;
    const bucket = hourlyHeartRate.get(key);
    const value = bucket?.avg ?? (bucket ? bucket.sum / bucket.count : null);
    const boundary = cursor + 3_600_000;
    const duration = Math.min(end, boundary) - cursor;
    if (value != null && duration > 0) {
      weighted += value * duration;
      seconds += duration;
    }
    cursor = Math.min(end, boundary);
  }
  return seconds ? weighted / seconds : null;
}

function valueMap(metric, sources) {
  const result = new Map();
  for (const source of sources) {
    const sourceMap = metric.get(source);
    if (!sourceMap) continue;
    for (const [key, value] of sourceMap) result.set(key, value);
  }
  return result;
}

function selectedSourceRows(sourceByKey, available, ordered) {
  const rows = new Map();
  for (const key of sourceByKey.keys()) {
    for (const source of ordered) {
      if (sourceByKey.get(key)?.has(source)) {
        rows.set(key, { source, ...sourceByKey.get(key).get(source) });
        break;
      }
    }
  }
  return rows;
}

function fillArray(length, value = null) {
  return Array.from({ length }, () => value);
}

function addDays(dateKey, days) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function compareDates(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildHealthData(entries, { timeZone = "UTC", onProgress = () => {} } = {}) {
  const sumRaw = new Map();
  const avgRaw = new Map();
  const heartRaw = new Map();
  const sleepRaw = new Map();
  const points = new Map();
  const workouts = [];
  const events = [];
  const behavior = {
    mindful: new Map(),
    mindfulCount: new Map(),
    handwashing: new Map(),
    stand: new Map(),
    standIdle: new Map(),
  };

  let rowCount = 0;
  let processedRows = 0;
  let firstDate = null;
  let lastDate = null;
  const fileMetrics = [];

  for (const [fileIndex, entry] of entries.entries()) {
    const metric = metricFromFileName(entry.name);
    fileMetrics.push(metric);
    let fileRows = 0;
    const rows = entry.rows || parseCsvRows(entry.text || "");
    for (const row of rows) {
      rowCount += 1;
      fileRows += 1;
      const start = parseDate(row.startDate);
      const end = parseDate(row.endDate);
      if (!start || !end) continue;
      processedRows += 1;
      firstDate = firstDate && firstDate < start ? firstDate : start;
      lastDate = lastDate && lastDate > end ? lastDate : end;
      const localStart = dateParts(start, timeZone);
      const source = sourceName(row);
      const value = parseNumber(row.value);
      const day = localStart.date;
      const hour = localStart.hour;

      if (metric in SUM_METRICS) {
        if (value == null) continue;
        const target = SUM_METRICS[metric];
        const metricMap = ensureMap(sumRaw, target);
        const sourceMap = ensureMap(metricMap, source);
        const key = `${day}|${hour}`;
        sourceMap.set(key, (sourceMap.get(key) || 0) + value);
        continue;
      }

      if (metric === "HeartRate") {
        if (value == null) continue;
        const key = `${source}|${day}|${hour}`;
        const bucket = heartRaw.get(key) || { sum: 0, count: 0, min: Infinity, max: -Infinity };
        bucket.sum += value;
        bucket.count += 1;
        bucket.min = Math.min(bucket.min, value);
        bucket.max = Math.max(bucket.max, value);
        heartRaw.set(key, bucket);
        continue;
      }

      if (metric in AVG_METRICS) {
        if (value == null) continue;
        const target = AVG_METRICS[metric];
        const metricMap = ensureMap(avgRaw, target);
        const sourceMap = ensureMap(metricMap, source);
        const bucket = sourceMap.get(day) || { sum: 0, count: 0, min: Infinity, max: -Infinity };
        bucket.sum += value;
        bucket.count += 1;
        bucket.min = Math.min(bucket.min, value);
        bucket.max = Math.max(bucket.max, value);
        sourceMap.set(day, bucket);
        if (POINT_METRICS.has(metric)) {
          if (!points.has(metric)) points.set(metric, []);
          points.get(metric).push({
            date: day,
            start: start.toISOString(),
            value,
            source,
          });
        }
        continue;
      }

      if (metric === "SleepAnalysis") {
        const midpoint = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
        const sleepDay = dateKeyOf(midpoint, timeZone);
        const key = `${source}|${sleepDay}`;
        if (!sleepRaw.has(key)) sleepRaw.set(key, []);
        sleepRaw.get(key).push({
          start: start.getTime(),
          end: end.getTime(),
          value: String(row.value || ""),
        });
        continue;
      }

      if (metric === "MindfulSession") {
        const current = behavior.mindful.get(`${source}|${day}`) || 0;
        behavior.mindful.set(`${source}|${day}`, current + (end - start) / 60_000);
        behavior.mindfulCount.set(source, (behavior.mindfulCount.get(source) || 0) + 1);
        continue;
      }

      if (metric === "HandwashingEvent") {
        behavior.handwashing.set(day, (behavior.handwashing.get(day) || 0) + 1);
        continue;
      }

      if (metric === "AppleStandHour") {
        const map = String(row.value) === "stood" ? behavior.stand : behavior.standIdle;
        map.set(day, (map.get(day) || 0) + 1);
        continue;
      }

      if (metric === "HighHeartRateEvent") {
        events.push({
          type: "high_heart_rate",
          date: day,
          start: start.toISOString(),
          end: end.toISOString(),
          threshold: String(row.HKHeartRateEventThreshold || ""),
        });
        continue;
      }

      if (metric === "AudioExposureEvent") {
        events.push({
          type: "audio_exposure",
          date: day,
          start: start.toISOString(),
          end: end.toISOString(),
          value: parseNumber(row.HKMetadataKeyAudioExposureLevel),
          threshold: "",
        });
        continue;
      }

      if (isWorkoutFile(entry.name)) {
        const duration = parseNumber(row.duration) || 0;
        const durationUnit = String(row.durationUnit || "sec").toLowerCase();
        workouts.push({
          type: metric,
          date: day,
          start: start.toISOString(),
          end: end.toISOString(),
          duration_min:
            durationUnit.startsWith("min") ? duration : duration / 60,
          distance_km: (parseNumber(row.totalDistance) || 0) / 1000,
          energy: parseNumber(row.totalEnergyBurned) || 0,
          source,
        });
        continue;
      }

      if (POINT_METRICS.has(metric) && value != null) {
        if (!points.has(metric)) points.set(metric, []);
        points.get(metric).push({
          date: day,
          start: start.toISOString(),
          value,
          source,
        });
      }
    }
    onProgress({
      current: fileIndex + 1,
      total: entries.length,
      metric,
      rows: fileRows,
    });
    entry.rows = null;
  }

  const sourceByDay = (raw) => {
    const output = new Map();
    for (const [source, rows] of raw) {
      for (const [key, value] of rows) {
        const [day] = key.split("|");
        if (!output.has(day)) output.set(day, new Map());
        if (!output.get(day).has(source)) output.get(day).set(source, { sum: 0 });
        output.get(day).get(source).sum += value;
      }
    }
    return output;
  };

  const selectedSum = new Map();
  for (const [metric, raw] of sumRaw) {
    const byDay = sourceByDay(raw);
    const available = new Set(raw.keys());
    const ordered = orderedSources(metric, available);
    selectedSum.set(metric, { byDay, ordered });
  }

  const selectedAvg = new Map();
  for (const [metric, raw] of avgRaw) {
    const days = new Map();
    const available = new Set(raw.keys());
    const ordered = orderedSources(metric, available);
    for (const source of ordered) {
      const sourceMap = raw.get(source);
      if (!sourceMap) continue;
      for (const [day, bucket] of sourceMap) {
        if (!days.has(day)) {
          days.set(day, {
            value: bucket.sum / bucket.count,
            count: bucket.count,
            min: bucket.min,
            max: bucket.max,
            source,
          });
        }
      }
    }
    selectedAvg.set(metric, days);
  }

  const heartBySourceDay = new Map();
  const heartHourlyBySource = new Map();
  for (const [key, bucket] of heartRaw) {
    const [source, day, hour] = key.split("|");
    if (!heartHourlyBySource.has(`${day}|${hour}`)) {
      heartHourlyBySource.set(`${day}|${hour}`, new Map());
    }
    heartHourlyBySource.get(`${day}|${hour}`).set(source, bucket);
    const daily = heartBySourceDay.get(`${source}|${day}`) || {
      sum: 0,
      count: 0,
      min: Infinity,
      max: -Infinity,
    };
    daily.sum += bucket.sum;
    daily.count += bucket.count;
    daily.min = Math.min(daily.min, bucket.min);
    daily.max = Math.max(daily.max, bucket.max);
    heartBySourceDay.set(`${source}|${day}`, daily);
  }
  const heartDays = new Map();
  const availableHeart = new Set(
    [...heartBySourceDay.keys()].map((key) => key.split("|")[0]),
  );
  const heartOrdered = orderedSources("heart_rate", availableHeart);
  for (const [key, bucket] of heartBySourceDay) {
    const [source, day] = key.split("|");
    if (!heartDays.has(day)) {
      heartDays.set(day, {
        avg: bucket.sum / bucket.count,
        min: bucket.min,
        max: bucket.max,
        count: bucket.count,
        source,
      });
    } else if (heartOrdered.indexOf(source) < heartOrdered.indexOf(heartDays.get(day).source)) {
      heartDays.set(day, {
        avg: bucket.sum / bucket.count,
        min: bucket.min,
        max: bucket.max,
        count: bucket.count,
        source,
      });
    }
  }

  const selectedHourly = new Map();
  for (const [metric, raw] of sumRaw) {
    const ordered = orderedSources(metric, new Set(raw.keys()));
    const ranks = new Map(ordered.map((source, index) => [source, index]));
    const buckets = new Map();
    for (const [source, sourceRows] of raw) {
      const rank = ranks.get(source) ?? 1_000;
      for (const [key, value] of sourceRows) {
        const existing = buckets.get(key);
        if (!existing || rank < existing.rank) {
          buckets.set(key, { rank, value, source });
        }
      }
    }
    selectedHourly.set(metric, buckets);
  }

  const selectedHeartHourly = new Map();
  for (const [key, sourceMap] of heartHourlyBySource) {
    for (const source of heartOrdered) {
      if (sourceMap.has(source)) {
        selectedHeartHourly.set(key, sourceMap.get(source));
        break;
      }
    }
  }

  const sumDaily = new Map();
  for (const [metric, raw] of sumRaw) {
    const byDay = sourceByDay(raw);
    const available = new Set(raw.keys());
    const ordered = orderedSources(metric, available);
    for (const [day, sourceMap] of byDay) {
      for (const source of ordered) {
        if (sourceMap.has(source)) {
          if (!sumDaily.has(day)) sumDaily.set(day, {});
          sumDaily.get(day)[metric] = {
            value: sourceMap.get(source).sum,
            source,
          };
          break;
        }
      }
    }
  }

  const sleepCandidates = buildSleepCandidates(sleepRaw, timeZone);
  const selectedSleep = selectSleep(sleepCandidates, timeZone);

  const allDays = new Set([
    ...sumDaily.keys(),
    ...heartDays.keys(),
    ...selectedSleep.keys(),
  ]);
  for (const days of selectedAvg.values()) for (const day of days.keys()) allDays.add(day);
  for (const item of workouts) allDays.add(item.date);
  for (const item of events) allDays.add(item.date);
  for (const key of behavior.handwashing.keys()) allDays.add(key);
  for (const key of behavior.stand.keys()) allDays.add(key);
  for (const key of behavior.mindful.keys()) allDays.add(key.split("|")[1]);

  const workoutByDay = new Map();
  for (const workout of workouts) {
    const bucket = workoutByDay.get(workout.date) || { min: 0, count: 0, kcal: 0 };
    bucket.min += workout.duration_min;
    bucket.count += 1;
    bucket.kcal += workout.energy;
    workoutByDay.set(workout.date, bucket);
  }

  const mindfulByDay = new Map();
  for (const [key, minutes] of behavior.mindful) {
    const day = key.split("|")[1];
    mindfulByDay.set(day, (mindfulByDay.get(day) || 0) + minutes);
  }

  const daily = [...allDays].sort(compareDates).map((day) => {
    const row = { date: day };
    for (const [metric, value] of Object.entries(sumDaily.get(day) || {})) row[metric] = value.value;
    for (const [metric, days] of selectedAvg) {
      const item = days.get(day);
      if (item) row[metric] = item.value;
    }
    const heart = heartDays.get(day);
    if (heart) {
      row.heart_rate = heart.avg;
      row.heart_rate_min = heart.min;
      row.heart_rate_max = heart.max;
    }
    const sleep = selectedSleep.get(day);
    if (sleep) {
      Object.assign(row, {
        asleep_hours: sleep.asleepHours,
        in_bed_hours: sleep.inBedHours,
        bed_start: sleep.bedStart.toISOString(),
        bed_end: sleep.bedEnd.toISOString(),
        bedtime_min: sleep.bedtimeMin,
        wake_min: sleep.wakeMin,
        midpoint_min: sleep.midpointMin,
        core_min: sleep.core,
        rem_min: sleep.rem,
        deep_min: sleep.deep,
        awake_min: sleep.awake,
        is_main_sleep: sleep.isMainSleep,
        night_hr: nightHeartRate(sleep, selectedHeartHourly, timeZone),
      });
    }
    const workout = workoutByDay.get(day) || { min: 0, count: 0, kcal: 0 };
    row.workout_min = workout.min;
    row.workout_count = workout.count;
    row.workout_kcal = workout.kcal;
    row.stand_hours = behavior.stand.get(day) || 0;
    row.stand_idle_hours = behavior.standIdle.get(day) || 0;
    row.handwashing = behavior.handwashing.get(day) || 0;
    row.mindful_min = mindfulByDay.get(day) || 0;
    return row;
  });

  const monthly = new Map();
  for (const row of daily) {
    const month = row.date.slice(0, 7);
    if (!monthly.has(month)) monthly.set(month, {});
    const target = monthly.get(month);
    for (const field of [
      "steps",
      "active_energy",
      "basal_energy",
      "distance_wr",
      "distance_cycling",
      "flights",
      "exercise_min",
      "stand_min",
      "stand_hours",
      "heart_rate",
      "resting_hr",
      "hrv",
      "respiratory_rate",
      "oxygen",
      "walking_speed",
      "step_length",
      "asymmetry",
      "double_support",
      "walking_steadiness",
      "vo2max",
      "walking_hr",
      "wrist_temp",
      "environmental_db",
      "headphone_db",
      "asleep_hours",
      "in_bed_hours",
    ]) {
      if (row[field] == null) continue;
      if (field === "asleep_hours" || field === "in_bed_hours") {
        if (!row.is_main_sleep) continue;
      }
      if (!target[field]) target[field] = [];
      target[field].push(row[field]);
    }
    target.mindful_min_sum = (target.mindful_min_sum || 0) + (row.mindful_min || 0);
    target.workout_count_sum = (target.workout_count_sum || 0) + (row.workout_count || 0);
  }

  const monthlyRows = [...monthly.entries()].map(([date, values]) => {
    const row = { date };
    for (const [field, items] of Object.entries(values)) {
      if (Array.isArray(items)) {
        row[`${field}_mean`] = mean(items);
      } else {
        row[field] = items;
      }
    }
    return row;
  });

  const sleepStageMonthly = daily
    .filter((row) => row.is_main_sleep && row.core_min != null)
    .reduce((map, row) => {
      const month = row.date.slice(0, 7);
      if (!map.has(month)) map.set(month, { core: [], rem: [], deep: [], awake: [] });
      const target = map.get(month);
      target.core.push(row.core_min);
      target.rem.push(row.rem_min);
      target.deep.push(row.deep_min);
      target.awake.push(row.awake_min);
      return map;
    }, new Map());
  const sleepStages = [...sleepStageMonthly.entries()].map(([date, values]) => ({
    date,
    core: mean(values.core),
    rem: mean(values.rem),
    deep: mean(values.deep),
    awake: mean(values.awake),
  }));

  const hourProfile = {};
  for (const metric of ["steps", "active_energy", "distance_wr", "flights"]) {
    const totals = fillArray(24, 0);
    const counts = fillArray(24, 0);
    for (const [key, selected] of selectedHourly.get(metric) || []) {
      const [, hour] = key.split("|");
      totals[Number(hour)] += selected.value;
      counts[Number(hour)] += 1;
    }
    hourProfile[metric] = {
      mean: totals.map((total, index) => (counts[index] ? total / counts[index] : 0)),
    };
  }
  const heartHourTotals = fillArray(24, 0);
  const heartHourCounts = fillArray(24, 0);
  for (const [key, value] of selectedHeartHourly) {
    const hour = Number(key.split("|")[1]);
    heartHourTotals[hour] += value.sum / value.count;
    heartHourCounts[hour] += 1;
  }
  hourProfile.heart_rate = {
    mean: heartHourTotals.map((total, index) =>
      heartHourCounts[index] ? total / heartHourCounts[index] : 0,
    ),
  };

  const weekdayProfile = {
    steps: fillArray(7, 0),
    active_energy: fillArray(7, 0),
    workout_min: fillArray(7, 0),
    asleep_hours: fillArray(7, 0),
    heart_rate: fillArray(7, 0),
  };
  const weekdayCounts = Object.fromEntries(Object.keys(weekdayProfile).map((key) => [key, fillArray(7, 0)]));
  for (const row of daily) {
    const weekday = (parseIsoDate(row.date).getUTCDay() + 6) % 7;
    for (const field of ["steps", "active_energy", "workout_min", "heart_rate"]) {
      if (row[field] == null) continue;
      weekdayProfile[field][weekday] += row[field];
      weekdayCounts[field][weekday] += 1;
    }
    if (row.is_main_sleep && row.asleep_hours != null) {
      weekdayProfile.asleep_hours[weekday] += row.asleep_hours;
      weekdayCounts.asleep_hours[weekday] += 1;
    }
  }
  for (const field of Object.keys(weekdayProfile)) {
    weekdayProfile[field] = weekdayProfile[field].map((total, index) =>
      weekdayCounts[field][index] ? total / weekdayCounts[field][index] : null,
    );
  }

  const workoutMonthly = new Map();
  for (const workout of workouts) {
    const month = workout.date.slice(0, 7);
    if (!workoutMonthly.has(month)) workoutMonthly.set(month, {});
    const target = workoutMonthly.get(month);
    if (!target[workout.type]) target[workout.type] = { min: 0, count: 0, km: 0, kcal: 0 };
    target[workout.type].min += workout.duration_min;
    target[workout.type].count += 1;
    target[workout.type].km += workout.distance_km;
    target[workout.type].kcal += workout.energy;
  }

  const histograms = {
    heart_rate: histogram(
      [...heartRaw.values()].map((bucket) => bucket.sum / bucket.count),
      30,
      180,
      51,
    ),
    walking_speed: histogram(
      daily.map((row) => row.walking_speed).filter((value) => value != null),
      0,
      8,
      24,
    ),
    step_length: histogram(
      daily.map((row) => row.step_length).filter((value) => value != null),
      10,
      140,
      24,
    ),
    asymmetry: histogram(
      daily.map((row) => row.asymmetry).filter((value) => value != null),
      0,
      1,
      20,
    ),
    double_support: histogram(
      daily.map((row) => row.double_support).filter((value) => value != null),
      0.1,
      0.4,
      20,
    ),
    hrv: histogram(
      daily.map((row) => row.hrv).filter((value) => value != null),
      0,
      200,
      24,
    ),
    headphone_db: histogram(
      daily.map((row) => row.headphone_db).filter((value) => value != null && value > 0),
      20,
      90,
      18,
    ),
    environmental_db: histogram(
      daily.map((row) => row.environmental_db).filter((value) => value != null),
      30,
      110,
      20,
    ),
  };

  const pointKeys = {
    BodyMass: "body_mass",
    Height: "height",
    BodyMassIndex: "bmi",
    BloodPressureSystolic: "bp_systolic",
    BloodPressureDiastolic: "bp_diastolic",
    ForcedVitalCapacity: "fvc",
    SixMinuteWalkTestDistance: "six_minute_walk",
    HeartRateRecoveryOneMinute: "heart_recovery",
    VO2Max: "vo2max",
    NikeFuel: "nike_fuel",
  };
  const pointSeries = Object.fromEntries(Object.values(pointKeys).map((key) => [key, []]));
  for (const [metric, rows] of points) {
    const target = pointKeys[metric];
    if (target) pointSeries[target].push(...rows);
  }
  for (const key of Object.keys(pointSeries)) pointSeries[key].sort((a, b) => a.date.localeCompare(b.date));

  const eventSeries = {
    high_heart_rate: events.filter((event) => event.type === "high_heart_rate"),
    audio_exposure: events.filter((event) => event.type === "audio_exposure"),
  };

  const coverage = {};
  for (const [metric] of sumRaw) coverage[metric] = { days: new Set(), sources: new Map() };
  for (const [metric] of avgRaw) coverage[metric] = { days: new Set(), sources: new Map() };
  coverage.heart_rate = { days: new Set(), sources: new Map() };
  coverage.sleep = { days: new Set(), sources: new Map() };
  for (const row of daily) {
    for (const [metric, value] of Object.entries(sumDaily.get(row.date) || {})) {
      coverage[metric]?.days.add(row.date);
      const sources = coverage[metric]?.sources;
      sources?.set(value.source, (sources.get(value.source) || 0) + 1);
    }
    for (const [metric, days] of selectedAvg) {
      const selected = days.get(row.date);
      if (!selected) continue;
      coverage[metric]?.days.add(row.date);
      const sources = coverage[metric]?.sources;
      sources?.set(selected.source, (sources.get(selected.source) || 0) + 1);
    }
    if (row.heart_rate != null) {
      coverage.heart_rate.days.add(row.date);
      const source = heartDays.get(row.date)?.source;
      if (source) coverage.heart_rate.sources.set(source, (coverage.heart_rate.sources.get(source) || 0) + 1);
    }
    if (row.asleep_hours != null) {
      coverage.sleep.days.add(row.date);
      const source = selectedSleep.get(row.date)?.source;
      if (source) coverage.sleep.sources.set(source, (coverage.sleep.sources.get(source) || 0) + 1);
    }
  }
  for (const [metric, item] of Object.entries(coverage)) {
    item.days = item.days.size;
    item.sources = Object.fromEntries(item.sources);
  }

  const coverageMonthly = [];
  const coverageMap = new Map();
  for (const row of daily) {
    const month = row.date.slice(0, 7);
    if (!coverageMap.has(month)) coverageMap.set(month, {});
    const target = coverageMap.get(month);
    if (row.steps != null) target.steps = (target.steps || 0) + 1;
    if (row.active_energy != null) target.active_energy = (target.active_energy || 0) + 1;
    if (row.heart_rate != null) target.heart_rate = (target.heart_rate || 0) + 1;
    if (row.asleep_hours != null) target.sleep = (target.sleep || 0) + 1;
    if (row.hrv != null) target.hrv = (target.hrv || 0) + 1;
    if (row.walking_speed != null) target.walking_speed = (target.walking_speed || 0) + 1;
  }
  for (const [date, values] of coverageMap) coverageMonthly.push({ date, ...values });
  coverageMonthly.sort((a, b) => a.date.localeCompare(b.date));

  const gaps = {};
  for (const metric of ["steps", "heart_rate", "sleep", "active_energy", "hrv"]) {
    const dates =
      metric === "sleep"
        ? daily.filter((row) => row.is_main_sleep).map((row) => row.date)
        : daily.filter((row) => row[metric] != null).map((row) => row.date);
    const result = [];
    for (let index = 1; index < dates.length; index += 1) {
      const days = (parseIsoDate(dates[index]) - parseIsoDate(dates[index - 1])) / 86_400_000;
      if (days > 7) {
        result.push({
          start: addDays(dates[index - 1], 1),
          end: addDays(dates[index], -1),
          days: days - 1,
        });
      }
    }
    gaps[metric] = result.sort((a, b) => b.days - a.days).slice(0, 8);
  }

  const maxDate = daily.at(-1)?.date || null;
  const currentStart = maxDate ? addDays(maxDate, -89) : null;
  const previousStart = maxDate ? addDays(maxDate, -179) : null;
  const windowValues = (field, start, end, mainSleep = false) =>
    daily
      .filter((row) => row.date >= start && row.date <= end)
      .filter((row) => !mainSleep || row.is_main_sleep)
      .map((row) => row[field])
      .filter((value) => value != null);
  const recent90 = {
    days_with_data: windowValues("steps", currentStart, maxDate).length,
    steps: mean(windowValues("steps", currentStart, maxDate)) || 0,
    active_energy: mean(windowValues("active_energy", currentStart, maxDate)) || 0,
    asleep_hours: mean(windowValues("asleep_hours", currentStart, maxDate, true)) || 0,
    resting_hr: mean(windowValues("resting_hr", currentStart, maxDate)) || 0,
    hrv: mean(windowValues("hrv", currentStart, maxDate)) || 0,
    workout_min: windowValues("workout_min", currentStart, maxDate).reduce((a, b) => a + b, 0),
    workout_weekly_min:
      windowValues("workout_min", currentStart, maxDate).reduce((a, b) => a + b, 0) /
      (90 / 7),
    walking_speed: mean(windowValues("walking_speed", currentStart, maxDate)) || 0,
    night_hr: mean(windowValues("night_hr", currentStart, maxDate)) || 0,
  };
  const previous90 = {
    steps: mean(windowValues("steps", previousStart, addDays(maxDate, -90))) || 0,
    active_energy: mean(windowValues("active_energy", previousStart, addDays(maxDate, -90))) || 0,
    asleep_hours: mean(windowValues("asleep_hours", previousStart, addDays(maxDate, -90), true)) || 0,
    resting_hr: mean(windowValues("resting_hr", previousStart, addDays(maxDate, -90))) || 0,
    hrv: mean(windowValues("hrv", previousStart, addDays(maxDate, -90))) || 0,
    workout_min: windowValues("workout_min", previousStart, addDays(maxDate, -90)).reduce((a, b) => a + b, 0),
    workout_weekly_min:
      windowValues("workout_min", previousStart, addDays(maxDate, -90)).reduce((a, b) => a + b, 0) /
      (90 / 7),
    walking_speed: mean(windowValues("walking_speed", previousStart, addDays(maxDate, -90))) || 0,
  };
  const deltas = {};
  for (const field of ["steps", "active_energy", "asleep_hours", "resting_hr", "hrv", "workout_weekly_min", "walking_speed"]) {
    deltas[field] = {
      current: recent90[field],
      previous: previous90[field],
      change: recent90[field] - previous90[field],
    };
  }

  const pairs = (left, right, mainSleep = false) =>
    daily
      .filter((row) => row[left] != null && row[right] != null)
      .filter((row) => !mainSleep || row.is_main_sleep)
      .map((row) => [row[left], row[right]]);
  const correlations = {
    sleep_night_hr: pearson(pairs("asleep_hours", "night_hr", true)),
    sleep_hrv: pearson(pairs("asleep_hours", "hrv", true)),
    steps_resting_hr: pearson(pairs("steps", "resting_hr")),
    steps_hrv: pearson(pairs("steps", "hrv")),
    active_hrv: pearson(pairs("active_energy", "hrv")),
    bedtime_sleep: pearson(
      daily
        .filter((row) => row.is_main_sleep && row.bedtime_min != null && row.asleep_hours != null)
        .map((row) => [row.bedtime_min, row.asleep_hours]),
    ),
  };

  const mainSleepRows = daily.filter((row) => row.is_main_sleep && row.asleep_hours != null);
  const regularity = {
    n: mainSleepRows.length,
    duration_mean: mean(mainSleepRows.map((row) => row.asleep_hours)) || 0,
    duration_sd: standardDeviation(mainSleepRows.map((row) => row.asleep_hours)),
    midpoint_mean: mean(mainSleepRows.map((row) => row.midpoint_min)) || 0,
    midpoint_sd: standardDeviation(mainSleepRows.map((row) => row.midpoint_min)),
    weekend_midpoint: mean(
      mainSleepRows
        .filter((row) => [4, 5].includes(parseIsoDate(row.date).getUTCDay()))
        .map((row) => row.midpoint_min),
    ) || 0,
    weekday_midpoint: mean(
      mainSleepRows
        .filter((row) => ![4, 5].includes(parseIsoDate(row.date).getUTCDay()))
        .map((row) => row.midpoint_min),
    ) || 0,
  };
  regularity.social_jetlag_min = Math.abs(
    regularity.weekend_midpoint - regularity.weekday_midpoint,
  );

  const latestBodyMass = pointSeries.body_mass.at(-1)?.value || null;
  const latestHeight = pointSeries.height.at(-1)?.value || null;
  const latestBody = {
    mass: latestBodyMass,
    height: latestHeight,
    calculated_bmi:
      latestBodyMass && latestHeight
        ? Math.round((latestBodyMass / (latestHeight / 100) ** 2) * 10) / 10
        : null,
  };

  const insights = [];
  if (recent90.steps) {
    insights.push({
      section: "activity",
      level: "info",
      title: `近 90 天日均 ${Math.round(recent90.steps).toLocaleString()} 步`,
      body: `日均主动消耗约 ${Math.round(recent90.active_energy)} kcal，较前 90 天变化 ${Math.round(deltas.steps.change).toLocaleString()} 步。`,
    });
  }
  if (mainSleepRows.length) {
    insights.push({
      section: "sleep",
      level: "info",
      title: `主睡眠平均 ${mean(mainSleepRows.map((row) => row.asleep_hours)).toFixed(1)} 小时`,
      body: `睡眠时长波动约 ${regularity.duration_sd.toFixed(2)} 小时，社会时差约 ${regularity.social_jetlag_min.toFixed(0)} 分钟。`,
    });
  }
  if (recent90.resting_hr && recent90.hrv) {
    insights.push({
      section: "recovery",
      level: "info",
      title: `静息心率约 ${Math.round(recent90.resting_hr)} bpm，HRV 约 ${Math.round(recent90.hrv)} ms`,
      body: `静息心率较前 90 天变化 ${deltas.resting_hr.change.toFixed(1)} bpm；睡眠与 HRV 的相关性约为 ${correlations.sleep_hrv.r.toFixed(2)}。`,
    });
  }
  if (correlations.sleep_night_hr.n >= 10) {
    insights.push({
      section: "cross",
      level: "info",
      title: "更长的主睡眠与更低的夜间心率存在弱相关",
      body: `睡眠与夜间心率的相关系数约 ${correlations.sleep_night_hr.r.toFixed(2)}。`,
    });
  }
  if (workouts.length) {
    const typeCount = workouts.reduce((map, workout) => {
      map.set(workout.type, (map.get(workout.type) || 0) + 1);
      return map;
    }, new Map());
    const top = [...typeCount.entries()].sort((a, b) => b[1] - a[1])[0];
    insights.push({
      section: "workout",
      level: "info",
      title: `共记录 ${workouts.length} 次训练`,
      body: `${top[0]} 次数最多，为 ${top[1]} 次；近 90 天每周训练约 ${(recent90.workout_weekly_min / 60).toFixed(1)} 小时。`,
    });
  }
  if (latestBodyMass && latestHeight) {
    insights.push({
      section: "body",
      level: "info",
      title: `最新体重 ${latestBodyMass} kg，身高 ${latestHeight} cm`,
      body: `估算 BMI 约 ${latestBody.calculated_bmi}；体重记录需要同一设备和条件连续追踪。`,
    });
  }
  const highHeart = eventSeries.high_heart_rate.length;
  const audio = eventSeries.audio_exposure.length;
  if (highHeart || audio) {
    insights.push({
      section: "environment",
      level: "warn",
      title: "导出的健康提醒事件值得结合场景查看",
      body: `高心率提醒 ${highHeart} 次，音频暴露提醒 ${audio} 次。`,
    });
  }
  if (gaps.steps?.length) {
    const gap = gaps.steps[0];
    insights.push({
      section: "quality",
      level: "warn",
      title: "历史设备链存在断档",
      body: `步数最长断档约 ${gap.days} 天，跨设备趋势应分段解读。`,
    });
  }

  const selectedSourceDays = {};
  for (const row of daily) {
    for (const [metric, value] of Object.entries(sumDaily.get(row.date) || {})) {
      selectedSourceDays[metric] ||= {};
      selectedSourceDays[metric][value.source] =
        (selectedSourceDays[metric][value.source] || 0) + 1;
    }
    for (const [metric, days] of selectedAvg) {
      if (days.has(row.date)) {
        selectedSourceDays[metric] ||= {};
        selectedSourceDays[metric][days.get(row.date).source] =
          (selectedSourceDays[metric][days.get(row.date).source] || 0) + 1;
      }
    }
    if (row.heart_rate != null) {
      selectedSourceDays.heart_rate ||= {};
      selectedSourceDays.heart_rate[heartDays.get(row.date).source] =
        (selectedSourceDays.heart_rate[heartDays.get(row.date).source] || 0) + 1;
    }
    if (row.asleep_hours != null) {
      selectedSourceDays.sleep ||= {};
      selectedSourceDays.sleep[selectedSleep.get(row.date).source] =
        (selectedSourceDays.sleep[selectedSleep.get(row.date).source] || 0) + 1;
    }
  }

  const workoutSummary = [...workouts.reduce((map, workout) => {
    const existing = map.get(workout.type) || {
      type: workout.type,
      count: 0,
      duration_min: 0,
      distance_km: 0,
      energy: 0,
    };
    existing.count += 1;
    existing.duration_min += workout.duration_min;
    existing.distance_km += workout.distance_km;
    existing.energy += workout.energy;
    map.set(workout.type, existing);
    return map;
  }, new Map()).values()].sort((a, b) => b.duration_min - a.duration_min);

  return {
    meta: {
      generated_at: new Date().toISOString(),
      row_count: processedRows,
      file_count: entries.length,
      first_date: firstDate ? dateKeyOf(firstDate, timeZone) : "",
      last_date: lastDate ? dateKeyOf(lastDate, timeZone) : "",
      daily_min: daily[0]?.date || "",
      daily_max: daily.at(-1)?.date || "",
      time_zone: timeZone,
    },
    daily,
    monthly: monthlyRows,
    workouts,
    workout_summary: workoutSummary,
    workout_monthly: [...workoutMonthly.entries()].map(([date, types]) => ({ date, types })),
    hour_profile: hourProfile,
    weekday_profile: weekdayProfile,
    sleep_stage_monthly: sleepStages,
    histograms,
    points: pointSeries,
    events: eventSeries,
    coverage,
    coverage_monthly: coverageMonthly,
    gaps,
    kpis: { recent_90: recent90, previous_90: previous90 },
    deltas,
    correlations,
    regularity,
    latest_body: latestBody,
    insights,
    selected_source_days: selectedSourceDays,
  };
}
