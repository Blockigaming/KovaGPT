# Project rules

- Model-generated interactive chat controls use `kova-interactive` fences validated by src/lib/interactive-ui.mjs and rendered only by InteractiveBlock as native React controls; submissions are sent as the user's next message. Why: a closed schema means no model-supplied HTML/JS ever runs.
