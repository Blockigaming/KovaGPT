#!/usr/bin/env python3
"""Read-only inventory, public checkpoint metadata and Azure retail pricing.

No model weights, custom model code, credentials or billable resources are created.
Public checkpoint metadata is NOT a downloaded or verified checkpoint.
"""

import argparse
import concurrent.futures
import datetime
import json
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request


def azure(*args):
    return json.loads(subprocess.check_output(
        ["az", *args, "--only-show-errors", "-o", "json"], timeout=90
    ))


def public_json(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in {"huggingface.co", "prices.azure.com"}:
        raise ValueError("Unexpected metadata destination")
    with urllib.request.urlopen(url, timeout=40) as response:
        data = response.read(16 * 1024 * 1024 + 1)
    if len(data) > 16 * 1024 * 1024:
        raise ValueError("Metadata response exceeds limit")
    return json.loads(data)


def checkpoint(model):
    info = public_json("https://huggingface.co/api/models/" + model["repository"] + "?blobs=true")
    weights = [f for f in info.get("siblings", []) if f.get("rfilename", "").endswith(".safetensors")]
    sizes = [f.get("lfs", {}).get("size", f.get("size")) for f in weights]
    complete = bool(weights) and all(isinstance(n, int) and n > 0 for n in sizes)
    return {
        "alias": model["alias"], "repository": model["repository"],
        "observedRevision": info.get("sha"), "gated": info.get("gated"),
        "license": info.get("cardData", {}).get("license"),
        "safetensorsFiles": len(weights),
        "weightBytes": sum(sizes) if complete else None,
        "sizeMetadataComplete": complete, "downloaded": False,
    }


def prices(location, sku):
    query = " and ".join([
        "serviceName eq 'Virtual Machines'",
        "armRegionName eq '" + location + "'",
        "armSkuName eq '" + sku + "'",
    ])
    url = "https://prices.azure.com/api/retail/prices?" + urllib.parse.urlencode({
        "$filter": query, "currencyCode": "USD",
    })
    rows = []
    for _ in range(20):
        page = public_json(url)
        for row in page.get("Items", []):
            description = (row.get("productName", "") + " " + row.get("skuName", "")).lower()
            if (row.get("type") == "Consumption"
                    and row.get("armRegionName") == location
                    and row.get("armSkuName") == sku
                    and row.get("currencyCode") == "USD"
                    and not any(word in description for word in ["windows", "spot", "low priority"])
                    and row.get("unitOfMeasure") == "1 Hour"):
                rows.append({
                    key: row.get(key) for key in [
                        "productName", "skuName", "retailPrice", "unitOfMeasure",
                        "currencyCode", "effectiveStartDate", "meterId",
                    ]
                })
        url = page.get("NextPageLink")
        if not url:
            return {"location": location, "sku": sku, "publicLinuxHourlyQuotes": rows,
                    "complete": True, "accountDiscountsIncluded": False}
    raise ValueError("Pricing pagination exceeds limit")


def inventory(location, skus):
    quotas = azure("vm", "list-usage", "-l", location)
    offers = azure("vm", "list-skus", "-l", location, "--resource-type", "virtualMachines", "--all")
    selected = [row for row in offers if row.get("name") in skus]
    normalize = lambda name: "".join(c for c in name.lower() if c.isalnum())
    families = {normalize(row.get("family", "")) for row in selected}
    return {
        "location": location,
        "skus": [{key: row.get(key) for key in ["name", "family", "restrictions", "capabilities"]}
                 for row in selected],
        "quotas": [{"family": row["name"]["value"], "used": int(row["currentValue"]),
                    "limit": int(row["limit"])} for row in quotas
                   if normalize(row["name"]["value"]) in families | {"cores"}],
        "note": "Quota and SKU listing do not guarantee physical capacity or cross-node NVLink placement.",
    }


def attempt(task, function, *args):
    try:
        return {"task": task, "ok": True, "result": function(*args)}
    except Exception as error:
        # Never serialize command output, request headers or credential-bearing exception URLs.
        return {"task": task, "ok": False, "errorType": type(error).__name__}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--location", action="append", default=[])
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    locations = args.location or ["eastus"]
    if any(not location.isalnum() for location in locations):
        parser.error("Use Azure location identifiers such as eastus")
    output = Path(args.output)
    # Exclusive creation prevents replacing earlier operator evidence.
    with output.open("x", encoding="utf-8") as target:
        models = json.loads(Path(__file__).with_name("models.json").read_text())["models"]
        skus = sorted({model["qualificationCandidate"] for model in models})
        work = [("checkpoint:" + model["alias"], checkpoint, model) for model in models]
        work += [("inventory:" + location, inventory, location, skus) for location in locations]
        work += [("price:" + location + ":" + sku, prices, location, sku)
                 for location in locations for sku in skus]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            pending = [pool.submit(attempt, *task) for task in work]
            results = [future.result() for future in pending]
        report = {
            "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "readOnly": True, "deployable": False, "resourcesCreated": False,
            "weightsDownloaded": False, "results": results,
            "remainingGates": ["GPU quota and capacity", "approved compute/storage budget",
                               "license acceptance and attribution", "pinned runtime and checkpoint integrity",
                               "Azure topology, inference and all 18 mode acceptance tests",
                               "private gateway integration and production traffic verification"],
        }
        json.dump(report, target, indent=2)
    print(json.dumps({"output": str(output), "readOnly": True,
                      "successfulChecks": sum(row["ok"] for row in results),
                      "checks": len(results), "deployable": False}))


if __name__ == "__main__":
    main()
