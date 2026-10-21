export function transitionBrowserPreview(state, action) {
  if (action === "end") return "ended";
  if (state === "active" && action === "pause") return "paused";
  if (state === "paused" && action === "takeover") return "owner";
  if (state === "owner" && action === "release") return "paused";
  if (state === "paused" && action === "resume") return "active";
  return state;
}
