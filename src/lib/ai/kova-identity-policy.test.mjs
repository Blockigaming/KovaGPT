import test from "node:test";
import assert from "node:assert/strict";
import { kovaIdentityInstruction } from "./kova-identity-policy.mjs";

for (const [id, name] of [
  ["kova-xenon-4.6", "Kova Xenon 4.6"],
  ["kova-neon-4.6", "Kova Neon 4.6"],
  ["kova-argon-5", "Kova Argon 5"],
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
