# Project rules

- The current product contract is docs/product-final-specification.md, supplied by the owner on November 6, 2026. It restores authenticated Kova Work and autonomous execution; older tests describing Work as retired must follow this newer contract. Chat remains the main entry point.
- Preserve the exact foundations: Xenon 5 = Kimi K3, Neon 4.6 = Llama 4 Maverick, Argon 4.6 = DeepSeek V4 Flash July 2026. Do not substitute another foundation or claim a feature is live without real production evidence.
- Model-generated interactive chat controls use `kova-interactive` fences validated by src/lib/interactive-ui.mjs and rendered only by InteractiveBlock as native React controls; submissions are sent as the user's next message. Why: a closed schema means no model-supplied HTML/JS ever runs.
