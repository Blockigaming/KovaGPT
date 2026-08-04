import { pathToFileURL } from "node:url";

const URL_NAME = "VITE_SUPABASE_URL";
const KEY_NAME = "VITE_SUPABASE_PUBLISHABLE_KEY";
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;

function configurationError(name, reason) {
  return new Error(`${name} ${reason}.`);
}

function requiredValue(environment, name, maximumLength) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    throw configurationError(name, "is required");
  }
  if (value.length > maximumLength) {
    throw configurationError(name, "is unreasonably long");
  }
  if (CONTROL_OR_SPACE.test(value)) {
    throw configurationError(name, "must not contain whitespace or control characters");
  }
  return value;
}

function decodeJwtPayload(value) {
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function validatePublicBuildEnv(environment = process.env) {
  const rawUrl = requiredValue(environment, URL_NAME, 2_048);
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw configurationError(URL_NAME, "must be a valid URL");
  }
  if (url.protocol !== "https:") {
    throw configurationError(URL_NAME, "must use HTTPS");
  }
  if (url.username || url.password) {
    throw configurationError(URL_NAME, "must not contain credentials");
  }
  if (url.search || url.hash) {
    throw configurationError(URL_NAME, "must not contain a query or fragment");
  }
  if (url.pathname !== "/") {
    throw configurationError(URL_NAME, "must not contain a path");
  }

  const key = requiredValue(environment, KEY_NAME, 4_096);
  if (/^sb_secret_/i.test(key)) {
    throw configurationError(KEY_NAME, "must never be a Supabase secret key");
  }
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    return { supabaseUrl: url.origin, keyType: "publishable" };
  }

  const payload = decodeJwtPayload(key);
  if (payload?.role === "service_role") {
    throw configurationError(KEY_NAME, "must never be a service-role JWT");
  }
  if (payload?.role !== "anon") {
    throw configurationError(KEY_NAME, "must be a publishable key or legacy anon JWT");
  }
  return { supabaseUrl: url.origin, keyType: "legacy-anon" };
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  try {
    validatePublicBuildEnv();
    process.stdout.write("Public browser build configuration is valid.\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid public build configuration.";
    process.stderr.write(`Configuration error: ${message}\n`);
    process.exitCode = 1;
  }
}
