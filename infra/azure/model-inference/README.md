# Kova-owned Azure model inference — preparation only

The owner's current requirement is downloaded original model weights served on
Kova-operated Azure GPUs. The existing OpenRouter transport does not fulfill it.
No GPU runtime, model download, private endpoint or production self-hosted route
is deployed by these files. Keep the working production route until its replacement
has real inference evidence; do not label OpenRouter as self-hosted Azure inference.

`models.json` preserves all three original foundations and the immutable revisions
observed in their public repository metadata. These are not downloaded-weight
integrity receipts. GPU SKUs are qualification
candidates, not validated capacity assignments. In particular, Azure GB300 VMs
have four GPUs: Kimi's eight-GPU recipe needs a qualified multi-VM topology,
not merely two arbitrary VMs. Six efforts are execution policies over each model;
they do not require downloading eighteen independent checkpoints.

## Low-cost candidates and the owner's 120-token target

The target is now 120 visible output tokens/second across the service: 120 for one
active chat, 60 each for two, and 30 each for four. `throughput-target.json` records
the acceptance cases. A quoted server price is not proof it satisfies those cases.
System RAM, GPU memory, memory bandwidth and compute throughput are separate
constraints. Add capacity according to measured queueing and decode performance;
do not assume that adding RAM increases generation speed proportionally.

The earlier eight-GB300 Kimi example is a published vLLM qualification profile,
not proof of the cheapest possible deployment across all runtimes and formats.
Likewise, the earlier H200 quote is not a minimum price for hosting Argon.

KTransformers documents the original `DeepSeek-V4-Flash-0731` on a CPU/GPU offload
path with one RTX 5090 (32 GB GPU memory), at least 200 GB system RAM and roughly
340 GB storage. It reports 20+ tokens/second and 4–5 minute startup. That result
does not establish 120 tokens/second or equivalent performance on Azure A100/H100
hardware. It also does not establish a shared server for all three foundations.

Read-only Azure Retail Prices API quotes obtained November 8, 2026 UTC:

| East US candidate          | GPU / system RAM           | Standard USD/hour | Spot USD/hour | Spot compute for 730 hours |
| -------------------------- | -------------------------- | ----------------- | ------------- | -------------------------- |
| `Standard_NC24ads_A100_v4` | 1 A100 80 GB / 220 GiB     | 3.673             | 0.67877       | 495.50                     |
| `Standard_NC40ads_H100_v5` | 1 H100 NVL 94 GB / 320 GiB | 6.98              | 1.418336      | 1,035.39                   |

These are smaller qualification candidates, not validated 120-token solutions.
Spot prices can change, capacity is not guaranteed, and Spot VMs can be evicted.
The monthly arithmetic excludes disks, networking, tax and all other machines;
it is not a complete fleet quote. No GPU was provisioned or charged by this check.
The lowest quoted candidate must not be advertised as the cheapest configuration
meeting the target until actual inference and concurrency tests pass. Relevant
GPU-family quotas were zero when inspected.

## Read-only preflight

From an authenticated Azure CLI session, run:

```bash
python3 infra/azure/model-inference/preflight.py --location eastus --location eastus2 --output selfhost-preflight.json
```

This reads subscription quota/SKU restrictions, public retail Linux hourly quotes,
and public Hugging Face checkpoint revisions/file-size metadata. It does not accept
licenses, fetch gated tokens, download weights or model code, request quota,
create storage/GPUs, or alter the current website. Missing quotes/sizes/errors remain
explicit rather than being treated as free capacity or completed work. Retail
prices exclude account discounts, disks, bandwidth, tax and other services.
SKU discovery has its own 30-second deadline. If that lookup fails, verified quota
results remain in the report with an explicit partial-inventory warning; it does
not turn a timeout into an assertion that capacity is available.

## Required implementation and activation

1. Approve an explicit compute/storage budget; obtain the required GPU-family and
   regional vCPU quotas and actual capacity. Current East US inspection found zero
   relevant GPU-family quota and only a CPU `Standard_D2as_v4` work VM.
2. Have the account holder complete any required license acceptance. DeepSeek's
   repository declares MIT; Kimi uses its custom K3 license; Llama uses its
   Community License. Preserve copyright/notices and required attribution.
   Llama requires “Built with Llama” attribution and imposes additional model-naming
   requirements for distributed improved/fine-tuned models. Branding must not hide
   the actual foundation or imply Kova originally trained these weights.
3. Review the observed model revision, pin its immutable commit, and download the
   selected checkpoint format to approved persistent Azure storage. Verify every
   weight shard against its upstream digest. Record the actual file hashes and size.
4. Pin an appropriate inference image by digest and qualify its CUDA/driver/parser
   compatibility. Kimi's custom code must be reviewed before enabling remote code.
   Do not copy mutable nightly tags from documentation into production unchanged.
5. Serve each model behind private Azure networking with authenticated access and
   no public inference listener. Extend Kova's server-side provider adapter with
   operator-controlled endpoints, exact loaded-checkpoint identities, streaming,
   cancellation, tool/schema validation and measured usage. The existing staging
   endpoint validator is not a production private-network deployment.
6. Reuse the six bounded effort policies and plan entitlements. Route every Ultra
   reviewer to that same self-hosted foundation. Verify model/tokenizer revisions,
   native reasoning support, tools, multimodal capability where supported, budget
   accounting and all 18 real configurations before switching any customer traffic.
7. Inject the trusted Kova product identity at the gateway. Introduce as the
   appropriate Kova name; accurately disclose the foundation when asked and retain
   required notices. A system prompt is product behavior, not a change of provenance
   or proof of training. Self-hosted routes must not silently fall back to OpenRouter.
8. Switch the exact tested release, verify actual signed-in requests, retain
   rollback, and report loaded checkpoint hashes, GPU hosts, image digests,
   endpoint health, traffic and measured cost. Until then, self-hosting is incomplete.

## Primary references

- https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731
- https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct
- https://huggingface.co/moonshotai/Kimi-K3
- https://huggingface.co/moonshotai/Kimi-K3/blob/main/LICENSE
- https://recipes.vllm.ai/deepseek-ai/DeepSeek-V4-Flash
- https://recipes.vllm.ai/moonshotai/Kimi-K3
- https://github.com/kvcache-ai/ktransformers/blob/main/doc/en/DeepSeek-V4-Flash.md
- https://learn.microsoft.com/en-us/azure/virtual-machines/ncads-h100-v5
- https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nca100v4-series
- https://learn.microsoft.com/en-us/azure/virtual-machines/spot-vms
- https://prices.azure.com/api/retail/prices
- https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-h200-v5-series
- https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nd-gb300-v6-series
