import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeWeatherRequest,
  normalizeWeatherResponse,
} from "../../src/lib/weather-policy.mjs";

test("weather requests require exact finite coordinates and reduce precision", () => {
  assert.deepEqual(normalizeWeatherRequest({ latitude: 42.12345678, longitude: -71.98765432 }), {
    latitude: 42.123457,
    longitude: -71.987654,
  });
  for (const value of [
    null,
    {},
    { latitude: 0 },
    { latitude: 0, longitude: 0, account: "leak" },
    { latitude: "42", longitude: -71 },
    { latitude: Number.NaN, longitude: -71 },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: -181 },
  ]) {
    assert.equal(normalizeWeatherRequest(value), null);
  }
});

test("weather responses expose only bounded temperature and condition code", () => {
  assert.deepEqual(
    normalizeWeatherResponse({
      latitude: 42,
      longitude: -71,
      current: { temperature_2m: 71.6, weather_code: 3, providerSecret: "discarded" },
    }),
    { temperature: 72, code: 3 },
  );
  for (const value of [
    null,
    {},
    { current: null },
    { current: { temperature_2m: "72", weather_code: 3 } },
    { current: { temperature_2m: 72, weather_code: 3.5 } },
    { current: { temperature_2m: 201, weather_code: 3 } },
    { current: { temperature_2m: 72, weather_code: -1 } },
  ]) {
    assert.equal(normalizeWeatherResponse(value), null);
  }
});
