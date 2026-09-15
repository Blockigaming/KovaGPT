import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { planUpgrade } from "../../scripts/release/upgrade-database.mjs";

// Only the pre-Day-15 dependencies are stubbed. All ten captured production
// workspace migrations and all five pending source migrations execute verbatim.
