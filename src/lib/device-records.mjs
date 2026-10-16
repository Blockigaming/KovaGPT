import { principalScopedStorageKey } from "./principal-browser-storage.mjs";
export function readDeviceRecord(storage, base, actor, target) {
  const key = principalScopedStorageKey(base, actor);
  if (!key || !storage) throw new Error("Device recovery is unavailable.");
  const deletionEpoch = storage.getItem(
    principalScopedStorageKey("kova-device-record-epoch", actor),
  );
  const raw = storage.getItem(key);
  if (!raw) return { revision: null, value: null, deletionEpoch };
  if (raw.length > 1000000) throw new Error("Device recovery is too large to read safely.");
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.records) || data.records.length > 200)
    throw new Error("Device recovery needs review; existing data was preserved.");
  const row = data.records.find((row) => row.target === target);
  if (!row) return { revision: null, value: null, deletionEpoch };
  if (typeof row.revision !== "string" || !row.value || typeof row.value !== "object")
    throw new Error("Device recovery needs review; existing data was preserved.");
  return { revision: row.revision, value: row.value, deletionEpoch };
}
export async function saveDeviceRecord({
  storage,
  locks,
  base,
  actor,
  target,
  expectedRevision,
  expectedDeletionEpoch = null,
  value,
  current,
  randomUUID = () => crypto.randomUUID(),
}) {
  const key = principalScopedStorageKey(base, actor);
  if (!key || !storage || !locks?.request)
    throw new Error(
      "Safe device saving is unavailable in this browser. Keep this page open or export your draft.",
    );
  return locks.request(principalScopedStorageKey("kova-device-record-epoch", actor), () => {
    if (!current()) throw new Error("The account or recovery context changed.");
    const prior = readDeviceRecord(storage, base, actor, target);
    if (prior.revision !== expectedRevision || prior.deletionEpoch !== expectedDeletionEpoch)
      throw new Error(
        "This record changed in another tab. Your draft is retained; review the saved version before replacing it.",
      );
    const raw = storage.getItem(key);
    const data = raw ? JSON.parse(raw) : { version: 1, records: [] };
    const revision = randomUUID();
    const records = [
      ...data.records.filter((row) => row.target !== target),
      { target, revision, value },
    ];
    const encoded = JSON.stringify({ version: 1, records });
    if (records.length > 200 || encoded.length > 1000000)
      throw new Error("Device recovery is full. Export your draft before clearing recovery.");
    storage.setItem(key, encoded);
    if (storage.getItem(key) !== encoded)
      throw new Error("Device save was not confirmed. Your draft is retained.");
    return revision;
  });
}
