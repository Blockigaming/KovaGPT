# GPT-5.6 and zero-Lovable foundation validation checkpoint

Checkpoint date: 2026-08-10

This record applies only to draft PR #143 and branch `program/azure-gpt56-foundation`.

## Completed on the isolated branch

- The active AI provider adapter targets only `https://api.openai.com/v1` and uses only `OPENAI_API_KEY`.
- Text generation uses the Responses API compatibility boundary.
- Chat Completions-style function definitions are flattened into Responses API function tools.
- Luna, Terra, and Sol prices match the reviewed August 10, 2026 standard-processing catalog.
- Long-context cost estimation applies the documented GPT-5.6 threshold multipliers.
- Routine traffic routes to Luna, deliberate reasoning to Terra, and only explicit Extra high/Pro/deep work to Sol when entitled.
- The full visible reasoning scale is represented: `none`, `low`, `medium`, `high`, `xhigh`, and `max`.
- GPT Image 2 is the image-generation default.
- All four legacy Lovable email endpoints fail closed with `410 Gone`.
- Lovable email SDK packages are removed from npm package metadata and the stale Bun lockfile is removed.
- The release security scanner rejects Lovable SDK, credential, gateway, hostname, or metered endpoint references in executable runtime and package metadata.
- Camera, microphone, and USB permissions remain denied while same-origin geolocation remains available for the existing explicit location feature.
- Dead image-reference controls that had no server implementation are removed rather than shown as fake capability.
- Repository tests that described the retired provider behavior are aligned with the new fail-closed boundary.

## Still required before merge or deployment

1. Normal repository formatting, lint, typecheck, unit, API, integration, browser, accessibility, production build, and release checks must pass on this exact head.
2. A tiny synthetic live OpenAI staging smoke test must verify each configured GPT-5.6 model ID before generation is enabled.
3. Tool-call streaming and multi-hop continuation need an authenticated end-to-end staging test.
4. Maximum and actual cost accounting must be reconciled against returned provider usage.
5. No Azure deployment or production Supabase/Auth migration is authorized by this checkpoint.
6. Draft database-chain repairs #158, #161, and #163 remain separate and unmerged.
7. The isolated Auth rehearsal chain #140-#142 remains separate, draft, and unmerged.

A passing GitHub check does not authorize production promotion.
