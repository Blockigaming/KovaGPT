# Kova Chat family selection source contract

The September 20 owner decision supersedes the earlier one-model Chat target.
This source catalog follows the Models `current-product-policy.v3.json`: Chat has
Cosmo and Orion families, six processing levels per family and no Nova Chat or
separate 8B Chat slot. A level is a setting over its selected family, not a new
model. Lite maps to the preserved internal `light` effort; the legacy Chat
`instant` ID is not accepted by the new family/effort selector. Guest and Free can
choose Cosmo Lite; Plus can choose both families at Lite, Medium and High; Pro
can choose both families at Lite through Ultra. Auto requires a separate trusted
server classifier and is not another model or accepted client family/effort.

`src/lib/kova-chat-policy.mjs` offers immutable route descriptions, a strict
family/effort parser, and the exact `kova-models.v2` selection envelope. Its
server-context authorization helper requires tier policy, an exact allowed
route and a separately verified runtime route. Catalog options always mark
`runtimeVerified: false`. The application Chat ingress now validates an explicit
`kovaModel: { family, effort }` request. After server plan resolution, it rejects
unentitled choices with 403 and entitled choices with 503 while no verified
runtime route or loaded-model identity exists. Neither case calls the existing
provider. Requests without `kovaModel` continue through the existing provider
route. There is still no live Kova dispatch, usage balance, browser streaming
or reconnect acceptance; the older prompt and client mode labels need
reconciliation when that path is integrated. Models Phase A A24/A36/A39 remain
open; 30/40 verified, Phase B NOT READY. No merge, deployment, GPU or paid action
is authorized here.

Tier-specific option labels present Lite by default and call the Plus High
effort Thinking. Pro keeps the High label. These are display names only: the
canonical route remains `chat:{family}:high` and the Models v2 selection wire
value remains `High`; the label cannot grant a route or mark a runtime verified.
