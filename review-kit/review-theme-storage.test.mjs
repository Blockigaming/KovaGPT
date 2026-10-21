import assert from "node:assert/strict";
import test from "node:test";
import { initialStorage } from "./private-http-review.mjs";

for (const theme of ["light", "dark", "system"]) {
  test(`explicit ${theme} review reset agrees with the synthetic principal preference`, () => {
    for (const account of ["free", "plus", "pro"]) {
      const storage = initialStorage({ account, theme, scenario: "default", state: "populated" });
      const session = JSON.parse(storage["sb-127-auth-token"]);
      const key = `nova-gpt-settings-v1:${session.user.id}`;
      assert.equal(storage["kova-theme-mode"], theme);
      assert.deepEqual(JSON.parse(storage[key]), { mode: theme });
      assert.equal(
        Object.keys(storage).filter((k) => k.startsWith("nova-gpt-settings-v1:")).length,
        1,
      );
      assert.equal(storage["nova-gpt-settings-v1:guest"], undefined);
    }
    const guest = initialStorage({
      account: "guest",
      theme,
      scenario: "default",
      state: "populated",
    });
    assert.equal(guest["kova-theme-mode"], theme);
    assert.equal(
      Object.keys(guest).some((k) => k.startsWith("nova-gpt-settings-v1:")),
      false,
    );
  });
}
