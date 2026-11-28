// A model-proposed viewport operation is valid only for the exact server-owned
// snapshot used to obtain its quote. No caller-supplied screenshot or action proof.
const fail = (code = "developer_computer_invalid") => {
  throw Error(code);
};
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();
const same = (a, b) => exact(a, Object.keys(b)) && Object.keys(b).every((k) => a[k] === b[k]);
export function mapComputerProposal(value) {
  if (
    value?.object !== "computer.proposal" ||
    value.status !== "proposed" ||
    value.requires_human_review !== true ||
    value.screenshot?.width !== 420 ||
    value.screenshot?.height !== 270 ||
    !Array.isArray(value.actions) ||
    value.actions.length !== 1
  )
    fail();
  const a = value.actions[0];
  if (["wait", "screenshot"].includes(a?.type) && exact(a, ["type"])) return { type: a.type };
  if (
    !Number.isSafeInteger(a?.x) ||
    !Number.isSafeInteger(a.y) ||
    a.x < 0 ||
    a.x >= 420 ||
    a.y < 0 ||
    a.y >= 270
  )
    fail();
  const p = { x: a.x * 2 + 1, y: a.y * 2 + 1 };
  if (a.type === "click" && exact(a, ["type", "x", "y", "button"]) && a.button === "left")
    return { type: "click", ...p, button: "left" };
  if (
    a.type === "scroll" &&
    exact(a, ["type", "x", "y", "scroll_x", "scroll_y"]) &&
    [a.scroll_x, a.scroll_y].every((n) => Number.isSafeInteger(n) && Math.abs(n) <= 600)
  )
    return { type: "scroll", ...p, scroll_x: a.scroll_x * 2, scroll_y: a.scroll_y * 2 };
  fail();
}
export function createComputerProposalGate(snapshot, view, signal, now = Date.now) {
  const lifetime = new AbortController();
  const workSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
  let state = "new",
    prepared,
    action;
  const check = (id) => {
    if (id !== snapshot || state === "closed") fail("developer_browser_conflict");
    workSignal.throwIfAborted();
  };
  return {
    get busy() {
      return state === "quoting" || state === "executing";
    },
    async quote(command, prepare) {
      check(command?.snapshot_id);
      if (
        state !== "new" ||
        !exact(command, ["snapshot_id", "model", "input", "max_output_tokens"]) ||
        typeof command.model !== "string" ||
        typeof command.input !== "string" ||
        !command.input.trim() ||
        Buffer.byteLength(command.input) > 8000 ||
        !Number.isSafeInteger(command.max_output_tokens) ||
        command.max_output_tokens < 1 ||
        command.max_output_tokens > 2048
      )
        fail();
      state = "quoting";
      try {
        const result = await prepare(
          view,
          {
            model: command.model,
            input: command.input,
            max_output_tokens: command.max_output_tokens,
          },
          workSignal,
        );
        check(command.snapshot_id);
        const q = result?.quote;
        if (
          !result?.input ||
          typeof q?.quoteToken !== "string" ||
          !q.quoteToken ||
          q.quoteToken.length > 2048 ||
          !Number.isFinite(q.maximumCharge) ||
          q.maximumCharge <= 0 ||
          !Number.isSafeInteger(q.expiresAt) ||
          q.expiresAt <= now() ||
          q.expiresAt > now() + 120000 ||
          typeof q.currency !== "string"
        )
          fail();
        prepared = { input: structuredClone(result.input), quote: structuredClone(q) };
        state = "quoted";
        return structuredClone(q);
      } catch (error) {
        if (state !== "closed") state = "new";
        throw error;
      }
    },
    async propose(command, execute) {
      check(command?.snapshot_id);
      if (
        state !== "quoted" ||
        !exact(command, ["snapshot_id", "approved", "quote_token", "request_key"]) ||
        command.approved !== true ||
        command.quote_token !== prepared.quote.quoteToken ||
        prepared.quote.expiresAt <= now() ||
        typeof command.request_key !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(command.request_key)
      )
        fail();
      // Consume before dispatch. Never retry a potentially charged model request.
      state = "executing";
      try {
        const result = await execute(
          prepared.input,
          command.request_key,
          prepared.quote.quoteToken,
          workSignal,
        );
        check(command.snapshot_id);
        if (result?.status === "blocked" || result?.status === "complete") {
          state = "consumed";
          return {
            status: result.status,
            text: String(result.text ?? "").slice(0, 32000),
            action: null,
          };
        }
        action = mapComputerProposal(result);
        state = "proposed";
        return {
          status: "proposed",
          text: String(result.text ?? "").slice(0, 32000),
          action: { ...action },
        };
      } catch (error) {
        if (state !== "closed") state = "consumed";
        throw error;
      } finally {
        prepared = undefined;
      }
    },
    accept(candidate) {
      check(snapshot);
      if (state !== "proposed" || !same(candidate, action))
        fail("developer_computer_proposal_required");
      state = "consumed";
      action = undefined;
    },
    close() {
      state = "closed";
      lifetime.abort();
      prepared = undefined;
      action = undefined;
    },
  };
}
