function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function coordinate(value, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return null;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function normalizeWeatherRequest(value) {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("latitude") ||
    !keys.includes("longitude") ||
    keys.some((key) => key !== "latitude" && key !== "longitude")
  ) {
    return null;
  }
  const latitude = coordinate(value.latitude, -90, 90);
  const longitude = coordinate(value.longitude, -180, 180);
  if (latitude === null || longitude === null) return null;
  return Object.freeze({ latitude, longitude });
}

export function normalizeWeatherResponse(value) {
  if (!isRecord(value) || !isRecord(value.current)) return null;
  const temperature = value.current.temperature_2m;
  const code = value.current.weather_code;
  if (
    typeof temperature !== "number" ||
    !Number.isFinite(temperature) ||
    temperature < -200 ||
    temperature > 200 ||
    typeof code !== "number" ||
    !Number.isSafeInteger(code) ||
    code < 0 ||
    code > 999
  ) {
    return null;
  }
  return Object.freeze({ temperature: Math.round(temperature), code });
}
