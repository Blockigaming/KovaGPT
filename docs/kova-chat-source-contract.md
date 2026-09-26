# Kova Chat family selection source contract

The September 20 owner decision supersedes the earlier one-model Chat target.
This source catalog follows the Models `current-product-policy.v3.json`: Chat has
Cosmo and Orion families, six processing levels per family and no Nova Chat or
separate 8B Chat slot. A level is a setting over its selected family, not a new
model. Lite maps to the preserved internal `light` effort. Guest and Free can
choose Cosmo Lite; Plus can choose both families at Lite, Medium and High; Pro
can choose both families at Lite through Ultra. Auto requires a separate trusted
server classifier and is not another model or accepted client family/effort.

`src/lib/kova-chat-policy.mjs` offers immutable route descriptions, a strict
family/effort parser, and the exact `kova-models.v2` selection envelope. Its
server-context authorization helper requires tier policy, an exact allowed
route and a separately verified runtime route. Catalog options always mark
`runtimeVerified: false`. There is no authenticated request handler, active
model proof, usage balance, streaming path or provider dispatch in this change;
the existing application continues on its separate provider route. The older
prompt and client mode labels must be reconciled when that application path is
actually integrated. Models Phase A A24/A36/A39 remain open; 30/40 verified,
Phase B NOT READY. No merge, deployment, GPU or paid action is authorized here.
