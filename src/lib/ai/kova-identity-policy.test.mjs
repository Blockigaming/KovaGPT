import test from "node:test";
import assert from "node:assert/strict";
import { kovaIdentityInstruction } from "./kova-identity-policy.mjs";

for (const [id, name] of [
  ["kova-xenon-5", "Kova Xenon 5"],
  ["kova-neon-4.6", "Kova Neon 4.6"],
  ["kova-argon-4.6", "Kova Argon 4.6"],
]) {
  test(`${name} uses its Kova identity and truthful provenance policy`, () => {
    const instruction = kovaIdentityInstruction(id);
    assert.match(instruction, new RegExp(name));
    assert.match(instruction, /answer accurately/);
    assert.match(instruction, /Never invent or conceal required attribution/);
  });
}
test("unknown model fails closed", () => {
  assert.throws(() => kovaIdentityInstruction("unknown"), /unknown_kova_model/);
});
