const quantity = (id, label, unit, aggregation, units) => ({
  type: "HKQuantityTypeIdentifier" + id,
  id,
  label,
  unit,
  aggregation,
  units,
});

export const APPLE_HEALTH_METRICS = [
  quantity("StepCount", "Steps", "steps", "sum", { count: 1 }),
  quantity("DistanceWalkingRunning", "Walking and running distance", "km", "sum", {
    km: 1,
    m: 0.001,
    mi: 1.609344,
  }),
  quantity("ActiveEnergyBurned", "Active energy", "kcal", "sum", { kcal: 1, kJ: 1 / 4.184 }),
  quantity("BasalEnergyBurned", "Resting energy", "kcal", "sum", { kcal: 1, kJ: 1 / 4.184 }),
  quantity("AppleExerciseTime", "Exercise time", "min", "sum", { min: 1, s: 1 / 60 }),
  quantity("AppleStandTime", "Standing time", "min", "sum", { min: 1, s: 1 / 60 }),
  quantity("FlightsClimbed", "Flights climbed", "flights", "sum", { count: 1 }),
  quantity("DistanceCycling", "Cycling distance", "km", "sum", { km: 1, m: 0.001, mi: 1.609344 }),
  quantity("DistanceSwimming", "Swimming distance", "m", "sum", { m: 1, km: 1000, yd: 0.9144 }),
  { type: "Workout", id: "Workouts", label: "Workouts", unit: "workouts", aggregation: "sum" },
  {
    type: "HKCategoryTypeIdentifierSleepAnalysis",
    id: "SleepAnalysis",
    label: "Time asleep",
    unit: "h",
    aggregation: "sleep",
  },
  quantity("HeartRate", "Heart rate", "bpm", "avg", { "count/min": 1 }),
  quantity("RestingHeartRate", "Resting heart rate", "bpm", "avg", { "count/min": 1 }),
  quantity("HeartRateVariabilitySDNN", "Heart rate variability", "ms", "avg", { ms: 1, s: 1000 }),
  quantity("WalkingHeartRateAverage", "Walking heart rate", "bpm", "avg", { "count/min": 1 }),
  quantity("RespiratoryRate", "Respiratory rate", "breaths/min", "avg", { "count/min": 1 }),
  quantity("OxygenSaturation", "Blood oxygen", "%", "avg", { "%": 1 }),
  quantity("VO2Max", "Cardio fitness", "mL/kg/min", "avg", {
    "mL/min·kg": 1,
    "mL/(kg·min)": 1,
    "mL/kg/min": 1,
    "ml/kg*min": 1,
  }),
  quantity("BodyMass", "Body weight", "kg", "last", { kg: 1, g: 0.001, lb: 0.45359237 }),
  quantity("BodyFatPercentage", "Body fat", "%", "last", { "%": 1 }),
  quantity("BodyMassIndex", "Body mass index", "BMI", "last", { count: 1 }),
];

export const APPLE_HEALTH_HISTORY_DAYS = 90;
export const APPLE_HEALTH_DAY_MS = 86_400_000;
