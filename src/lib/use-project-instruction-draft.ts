import { useCallback, useEffect, useRef, useState } from "react";

export function useProjectInstructionDraft({
  scopeKey,
  initialValue,
  initialRevision,
  canEdit,
  onSave,
  onReload,
}: {
  scopeKey: string;
  initialValue: string;
  initialRevision: string;
  canEdit: boolean;
  onSave: (value: string | null, expectedRevision: string) => Promise<string>;
  onReload: () => Promise<{ value: string; revision: string }>;
}) {
  const [draft, setDraft] = useState(initialValue);
  const [lastSaved, setLastSaved] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [remoteReview, setRemoteReview] = useState<{ value: string; revision: string } | null>(
    null,
  );
  const baseRevision = useRef(initialRevision);
  const generation = useRef(0);
  const acknowledgedRemote = useRef(initialValue);
  const mounted = useRef(false);
  const pending = useRef<{ value: string; generation: number } | null>(null);
  const latest = useRef({
    scopeKey,
    draft,
    lastSaved,
    canEdit,
    onSave,
    onReload,
    conflict,
    remoteReview,
  });
  latest.current = {
    scopeKey,
    draft,
    lastSaved,
    canEdit,
    onSave,
    onReload,
    conflict,
    remoteReview,
  };

  useEffect(() => {
    generation.current += 1;
    mounted.current = true;
    acknowledgedRemote.current = initialValue;
    baseRevision.current = initialRevision;
    pending.current = null;
    setDraft(initialValue);
    setLastSaved(initialValue);
    setSaving(false);
    setSaved(false);
    setError(null);
    setConflict(false);
    setRemoteReview(null);
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
    // A new server acknowledgement must not reset a newer local draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    const current = latest.current;
    if (initialValue === acknowledgedRemote.current && initialRevision === baseRevision.current)
      return;
    if (pending.current?.value.trim() === initialValue.trim()) return;
    if (!pending.current && current.draft === current.lastSaved) {
      setDraft(initialValue);
      setLastSaved(initialValue);
      acknowledgedRemote.current = initialValue;
      baseRevision.current = initialRevision;
      setSaved(false);
      setConflict(false);
      setRemoteReview(null);
      setError(null);
    } else {
      setConflict(true);
      setRemoteReview({ value: initialValue, revision: initialRevision });
      setError(
        "Saved instructions changed while you were editing. Your draft is preserved. Review it before replacing the saved instructions.",
      );
    }
  }, [initialValue, initialRevision]);

  const saveDraft = useCallback(async () => {
    const current = latest.current;
    if (!mounted.current || !current.canEdit || !current.scopeKey || pending.current) return;
    if (current.conflict && !current.remoteReview) return;
    const operation = { value: current.draft, generation: generation.current };
    const active = () =>
      generation.current === operation.generation && latest.current.scopeKey === current.scopeKey;
    pending.current = operation;
    setSaving(true);
    setSaved(false);
    setError(null);
    setConflict(false);
    try {
      const revision = await current.onSave(
        operation.value.trim() || null,
        current.conflict ? current.remoteReview!.revision : baseRevision.current,
      );
      if (!active()) return;
      baseRevision.current = revision;
      setRemoteReview(null);
      acknowledgedRemote.current = operation.value.trim();
      setLastSaved(operation.value);
      setSaved(latest.current.draft === operation.value);
    } catch (reason) {
      if (active()) {
        if (reason instanceof Error && reason.message.startsWith("Project changed")) {
          setConflict(true);
          setRemoteReview(null);
        }
        setError(reason instanceof Error ? reason.message : "Instructions were not saved.");
      }
    } finally {
      if (active()) {
        pending.current = null;
        setSaving(false);
      }
    }
  }, []);

  const reviewSaved = async () => {
    const current = latest.current;
    if (!mounted.current || pending.current || !current.scopeKey) return;
    const operation = { value: current.draft, generation: generation.current };
    const active = () =>
      operation.generation === generation.current && current.scopeKey === latest.current.scopeKey;
    pending.current = operation;
    setSaving(true);
    try {
      const snapshot = await current.onReload();
      if (active()) {
        setRemoteReview(snapshot);
        setConflict(true);
      }
    } catch (reason) {
      if (active())
        setError(
          reason instanceof Error ? reason.message : "Saved instructions could not be loaded.",
        );
    } finally {
      if (active()) {
        pending.current = null;
        setSaving(false);
      }
    }
  };

  const useSaved = () => {
    const snapshot = latest.current.remoteReview;
    if (!snapshot || pending.current) return;
    baseRevision.current = snapshot.revision;
    acknowledgedRemote.current = snapshot.value;
    latest.current.draft = snapshot.value;
    setDraft(snapshot.value);
    setLastSaved(snapshot.value);
    setConflict(false);
    setRemoteReview(null);
    setError(null);
    setSaved(false);
  };

  useEffect(() => {
    if (!canEdit || saving || error || draft === lastSaved) return;
    const timer = setTimeout(() => {
      void saveDraft();
    }, 900);
    return () => clearTimeout(timer);
  }, [scopeKey, canEdit, draft, lastSaved, saving, error, saveDraft]);

  const edit = (value: string) => {
    latest.current.draft = value;
    setDraft(value);
    setSaved(false);
    if (!conflict) setError(null);
  };

  return {
    draft,
    lastSaved,
    saving,
    saved,
    error,
    conflict,
    remoteReview,
    reviewSaved,
    useSaved,
    edit,
    saveDraft,
  };
}
