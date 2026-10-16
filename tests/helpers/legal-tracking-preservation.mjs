// Historical presentation guards reconcile only the declared active-tracking delegation.
export function restoreLegalTracking(source, prior) {
  const currentEffect = `  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    return trackLegalSection(root, setActiveId);
  }, []);`;
  const oldEffect = prior.match(/  useEffect\(\(\) => \{[\s\S]*?\n  \}, \[\]\);/)?.[0];
  if (!source.includes(currentEffect) || !oldEffect)
    throw new Error("Unexpected LegalDoc tracking structure");
  return source
    .replace('import { trackLegalSection } from "@/lib/legal-active-section";\n', "")
    .replace(currentEffect, oldEffect);
}
