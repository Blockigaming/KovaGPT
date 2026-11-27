# KovaGPT Python SDK

Repository-local server SDK for Python 3.10 or newer. No runtime dependencies, no automatic retries, and no registry publication. Run its offline tests with:

```sh
cd sdk/python
python -m unittest -v
```

Use a local source import or install this directory in a controlled development environment. Supply credentials only from your server secret manager. A model and enabled, funded project must be obtained from the real platform.

```python
import os
import uuid
from kovagpt import Client, response_events

client = Client(os.environ["KOVA_API_KEY"])
catalog = client.models()
with client.responses(
    {
        "model": os.environ["KOVA_PUBLIC_MODEL"],
        "input": "Summarize this text.",
        "max_output_tokens": 200,
        "stream": True,
    },
    currency=os.environ["KOVA_BUDGET_CURRENCY"],
    maximum_charge=float(os.environ["KOVA_REQUEST_BUDGET_MINOR"]),
    idempotency_key=str(uuid.uuid4()),
) as response:
    for event in response_events(response):
        if event.get("type") == "response.output_text.delta":
            print(event["delta"], end="")
```

The client supports scoped model discovery, usage list and retrieval, private text-file upload/list/retrieve/delete, Responses, images and gated image editing, embeddings, and gated text moderation. All inference operations use an explicit caller budget in minor currency units and an identical signed quote. Hosted tools and reasoning options are passed as ordinary validated Responses fields. The server determines real capability availability and pricing.

`quote` and `execute` can be used separately for an explicit confirmation screen. Always use the original idempotency key for retries of the same operation. An uncertain dispatch sets `KovaError.request_may_have_started`; inspect the real usage history before retrying. Never treat cancellation as proof of a refund.

The HTTPS transport verifies certificates, does not follow redirects, and applies a socket I/O timeout rather than a total wall-clock streaming deadline. Use a trusted service origin. Read JSON or use the response as a context manager to close its connection. Streaming requires an explicit terminal event; incomplete or failed events are not treated as successful output. No API key, price, provider or live account is bundled.

For a bounded text-only Chat Completions request use `client.chat_completions(data, **budget)`. The `client.search(data, **budget)` alias uses the gated native search meter and returns the Responses envelope, including native source annotations. The same quote and retry rules apply. Chat Completions streams use Chat Completions chunks; `response_events` is intended for native Responses streams only.
