# Live Storage payload identity check (September 26 ET / September 27 UTC)

Status: **read-only evidence for one M17 Storage object; M17 and M18 remain open.** No Storage write, database change, restore, or deployment occurred.

The Supabase connector was explicitly scoped to production project `mfbycmbjygcfkrsuepxf`. A read-only, repeatable-read catalog query on 2026-09-27 at 00:01:08 UTC reported two buckets: private `agent-evidence` and public `brand-assets`, both allowing PNGs with a 5,242,880-byte per-file limit. It reported one object, `brand-assets/kova-logo.png`, size 695,738 bytes and ETag `"08467e4ff99f7b0c1564ba0ced264199-1"`.

A separate HTTPS GET to the public Storage object endpoint returned 200, `image/png`, and 695,738 bytes. The downloaded bytes, the owner-supplied `KovaGPT Logo(1).png`, and this repository's `public/kova-logo.png` each yielded SHA-256 `566cd64480ac25307146106efc073064f2c2161935babb9625a370469dc24ae2` and size 695,738 bytes. Thus the tracked repository PNG is an independently retrievable copy of the live public Storage payload at capture time. Its MD5 is `4d27b9a22ac29626c1a8417e59b03457`; do not equate the object's multipart-style ETag to this MD5.

Recheck before cutover and after any Storage change:

```bash
curl --fail --location --silent --show-error \
  'https://mfbycmbjygcfkrsuepxf.supabase.co/storage/v1/object/public/brand-assets/kova-logo.png' \
  -o /tmp/kova-live-logo.png
sha256sum /tmp/kova-live-logo.png public/kova-logo.png
wc -c /tmp/kova-live-logo.png public/kova-logo.png
```

This binds the **one observed public object** to a retained source copy, rather than proving a complete Storage export or future object state. Bucket visibility, size limit, and allowed MIME types still need to be preserved and verified on the isolated target. The encrypted logical backup does not include Storage bytes. Managed Auth/Storage schema customization, provider configuration and keys, restore execution, and application behavior remain unproven. The 19 migration schema proofs remain blocked.
