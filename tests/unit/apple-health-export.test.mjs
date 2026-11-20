import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { readAppleHealthExport } from "../../src/health/apple-health-export.mjs";

const exportXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [<!ELEMENT HealthData ANY>]>
<HealthData locale="en_US">
  <ExportDate value="2026-11-20 12:00:00 -0500"/>
  <Me HKCharacteristicTypeIdentifierDateOfBirth="2000-01-01"/>
  <Record sourceName="Watch &amp; Fitness" value="912" unit="count"
    type="HKQuantityTypeIdentifierStepCount" startDate="2026-11-20 00:15:00 +0200"/>
  <Record sourceName="Watch &amp; Fitness" value="88" unit="count"
    type="HKQuantityTypeIdentifierStepCount" startDate="2026-11-20 08:00:00 -0500"/>
  <Record sourceName="iPhone" value="89" unit="count"
    type="HKQuantityTypeIdentifierStepCount" startDate="2026-11-14 08:00:00 -0500"/>
  <Record sourceName="iPhone" value="444" unit="count"
    type="HKQuantityTypeIdentifierStepCount" startDate="2026-11-13 08:00:00 -0500"/>
  <Record sourceName="iPhone" value="80" unit="count/min"
    type="HKQuantityTypeIdentifierHeartRate" startDate="2026-11-20 08:00:00 -0500"/>
  <Record sourceName="iPhone" value="92" unit="count/min"
    type="HKQuantityTypeIdentifierHeartRate" startDate="2026-11-20 08:30:00 -0500"/>
  <Record sourceName="Watch &amp; Fitness" value="HKCategoryValueSleepAnalysisAsleepCore"
    type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2026-11-19 23:00:00 -0500" endDate="2026-11-20 05:00:00 -0500"/>
  <Record sourceName="Watch &amp; Fitness" value="HKCategoryValueSleepAnalysisAsleepDeep"
    type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2026-11-20 04:30:00 -0500" endDate="2026-11-20 06:00:00 -0500"/>
  <Record sourceName="Watch &amp; Fitness" value="HKCategoryValueSleepAnalysisInBed"
    type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2026-11-19 22:00:00 -0500" endDate="2026-11-20 07:00:00 -0500"/>
  <Workout sourceName="iPhone" startDate="2026-11-19 11:00:00 -0500" duration="24" durationUnit="min" workoutActivityType="HKWorkoutActivityTypeRunning"/>
  <Record sourceName="iPhone" value="70" unit="kg"
    type="HKQuantityTypeIdentifierBodyMass" startDate="2026-11-20 10:00:00 -0500"/>
  <Record sourceName="iPhone" value="71" unit="kg"
    type="HKQuantityTypeIdentifierBodyMass" startDate="2026-11-20 08:00:00 -0500"/>
  <Record sourceName="iPhone" value="123456" unit="count"
    type="HKQuantityTypeIdentifierStepCount" startDate="2026-08-22 08:00:00 -0500"/>
</HealthData>`;
const expected = {
  asOf: "2026-11-20",
  metrics: {
    StepCount: [
      {
        name: "iPhone",
        days: [
          { date: "2026-08-22", value: 123456 },
          { date: "2026-11-13", value: 444 },
          { date: "2026-11-14", value: 89 },
        ],
      },
      { name: "Watch & Fitness", days: [{ date: "2026-11-20", value: 1000 }] },
    ],
    HeartRate: [{ name: "iPhone", days: [{ date: "2026-11-20", value: 86 }] }],
    SleepAnalysis: [{ name: "Watch & Fitness", days: [{ date: "2026-11-20", value: 7 }] }],
    SleepCore: [{ name: "Watch & Fitness", days: [{ date: "2026-11-20", value: 6 }] }],
    SleepDeep: [{ name: "Watch & Fitness", days: [{ date: "2026-11-20", value: 1.5 }] }],
    SleepInBed: [{ name: "Watch & Fitness", days: [{ date: "2026-11-20", value: 9 }] }],
    WorkoutDuration: [{ name: "iPhone", days: [{ date: "2026-11-19", value: 24 }] }],
    BodyMass: [{ name: "iPhone", days: [{ date: "2026-11-20", value: 70 }] }],
    Workouts: [{ name: "iPhone", days: [{ date: "2026-11-19", value: 1 }] }],
  },
};

test("Apple Health imports recent activity, sleep and body summaries by source in XML and ZIP", async () => {
  assert.deepEqual(await readAppleHealthExport(new File([exportXml], "export.xml")), expected);
  for (const level of [0, 6]) {
    const zip = zipSync(
      {
        "apple_health_export/apple_health_export_cda.xml": strToU8("<OtherData/>"),
        "apple_health_export/export.xml": strToU8(exportXml),
      },
      { level },
    );
    assert.deepEqual(await readAppleHealthExport(new File([zip], "export.zip")), expected);
  }
});

test("incomplete, unrelated, and aborted archives cannot produce a partial report", async () => {
  const wrapped = zipSync({ "export.xml": strToU8(exportXml) });
  const unrelated = zipSync({ "sample.xml": strToU8(exportXml) });
  for (const file of [
    new File(["<xml/>"], "export.xml"),
    new File([exportXml.replace("</HealthData>", "")], "export.xml"),
    new File([wrapped.subarray(0, wrapped.length - 16)], "export.zip"),
    new File([unrelated], "export.zip"),
  ]) {
    await assert.rejects(readAppleHealthExport(file));
  }

  await assert.rejects(
    readAppleHealthExport(new File([wrapped], "export.zip"), AbortSignal.abort()),
    { name: "AbortError" },
  );
});
