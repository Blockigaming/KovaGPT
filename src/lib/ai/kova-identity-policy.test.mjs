import test from "node:test";
import assert from "node:assert/strict";
import { KOVA_ASSISTANT_IDENTITY, kovaIdentityInstruction } from "./kova-identity-policy.mjs";

for (const [id, name] of Object.entries(KOVA_ASSISTANT_IDENTITY)) {
  test(`${name} uses its Kova identity and truthful provenance policy`, () => {
    const instruction = kovaIdentityInstruction(id);
    assert.match(instruction, new RegExp(name));
    assert.match(instruction, /ordinary identity questions/);
    assert.match(instruction, /only when asked/);
    assert.match(instruction, /never on greetings or ordinary tasks/);
    assert.match(instruction, /developed and refined by Kova/);
    assert.match(instruction, /upstream provider names, internal model IDs/);
    assert.match(instruction, /Never claim unverified Kova training or fine-tuning/);
    assert.match(instruction, /answer accurately/);
    assert.match(instruction, /Never invent or conceal required attribution/);
  });
}
test("unknown model fails closed", () => {
  assert.throws(() => kovaIdentityInstruction("unknown"), /unknown_kova_model/);
});
