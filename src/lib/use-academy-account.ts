import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getAcademyState, saveAcademyState } from "./academy-state.functions";
import {
  ACADEMY_ACCOUNT_PERSISTENCE_ENABLED,
  AcademyBody,
  AcademyRecord,
  type AcademyBodyValue,
  type AcademyRecordValue,
} from "./academy-state-policy.mjs";
import { EMPTY_ACADEMY_PROGRESS } from "./academy-progress.mjs";
export function useAcademyAccount(
  actor: string | null | undefined,
  topic: string,
  draft: {
    value: AcademyBodyValue;
    loaded: boolean;
    stored: boolean;
    allowAutomaticAccountHydration: boolean;
    dirty: boolean;
    epoch: number;
    setValue: (value: AcademyBodyValue) => void;
  },
) {
  const get = useServerFn(getAcademyState),
    save = useServerFn(saveAcademyState);
  const key = JSON.stringify([actor, topic, draft.epoch]),
    keyRef = useRef(key);
  keyRef.current = key;
  const epoch = useRef(0),
    pending = useRef(false),
    attempt = useRef<{ signature: string; id: string } | null>(null),
    latest = useRef(draft);
  latest.current = draft;
  const [state, setState] = useState<{
    key: string;
    loaded: boolean;
    record: AcademyRecordValue | null;
    error: string;
    pending: boolean;
  }>({ key, loaded: false, record: null, error: "", pending: false });
  const [retry, setRetry] = useState(0);
  const firstLoadScope = useRef<string | null>(null);
  useEffect(() => {
    const scopeEpoch = epoch;
    const generation = ++scopeEpoch.current;
    pending.current = false;
    attempt.current = null;
    setState({ key, loaded: false, record: null, error: "", pending: false });
    if (!ACADEMY_ACCOUNT_PERSISTENCE_ENABLED || !actor || !draft.loaded) return;
    const current = () => epoch.current === generation && keyRef.current === key;
    const startValue = latest.current.value;
    const scope = JSON.stringify([actor, topic]);
    const mayAdopt = firstLoadScope.current !== scope;
    firstLoadScope.current = scope;
    void get({ data: { expectedUserId: actor, topic } })
      .then((value) => {
        if (!current()) return;
        const record = value === null ? null : AcademyRecord.parse(value);
        if (record && (record.owner_id !== actor || record.topic !== topic))
          throw new Error("Account learning state identity mismatch.");
        setState({ key, loaded: true, record, error: "", pending: false });
        // Only a fresh untouched device adopts automatically. Recovered or newly typed
        // notes remain visible until the user explicitly chooses the account version.
        if (
          record &&
          mayAdopt &&
          latest.current.allowAutomaticAccountHydration &&
          latest.current.value === startValue &&
          !latest.current.stored &&
          !latest.current.dirty
        )
          latest.current.setValue(record.body);
      })
      .catch((e) => {
        if (current())
          setState({
            key,
            loaded: false,
            record: null,
            error: e instanceof Error ? e.message : "Account load failed",
            pending: false,
          });
      });
    return () => {
      ++scopeEpoch.current;
    };
  }, [key, actor, topic, draft.loaded, get, retry]);
  const visible =
    state.key === key ? state : { key, loaded: false, record: null, error: "", pending: false };
  const saveCurrent = async () => {
    if (!ACADEMY_ACCOUNT_PERSISTENCE_ENABLED || !actor || !visible.loaded || pending.current)
      return;
    const generation = epoch.current,
      current = () => epoch.current === generation && keyRef.current === key;
    const parsed = AcademyBody.safeParse(latest.current.value);
    if (!parsed.success) {
      setState((s) => ({
        ...s,
        error: "Notes exceed the account save limits. Export or shorten this draft.",
      }));
      return;
    }
    const body = parsed.data,
      revision = visible.record?.revision ?? 0;
    const signature = JSON.stringify([actor, topic, revision, body]);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, id: crypto.randomUUID() };
    pending.current = true;
    setState((s) => ({ ...s, pending: true, error: "" }));
    try {
      const record = AcademyRecord.parse(
        await save({
          data: {
            expectedUserId: actor,
            topic,
            expectedRevision: revision,
            mutationId: attempt.current.id,
            body,
          },
        }),
      );
      if (!current()) return;
      if (
        record.owner_id !== actor ||
        record.topic !== topic ||
        JSON.stringify(record.body) !== JSON.stringify(body)
      )
        throw new Error("Account save acknowledgement mismatch.");
      setState({ key, loaded: true, record, error: "", pending: false });
      attempt.current = null;
    } catch (e) {
      if (current())
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : "Account save failed" }));
    } finally {
      if (current()) {
        pending.current = false;
        setState((s) => ({ ...s, pending: false }));
      }
    }
  };
  return {
    ...visible,
    saveCurrent,
    refresh: () => setRetry((n) => n + 1),
    useAccount: () => {
      if (visible.loaded) latest.current.setValue(visible.record?.body ?? EMPTY_ACADEMY_PROGRESS);
    },
    matches:
      visible.loaded &&
      JSON.stringify(visible.record?.body ?? EMPTY_ACADEMY_PROGRESS) ===
        JSON.stringify(draft.value),
  };
}
