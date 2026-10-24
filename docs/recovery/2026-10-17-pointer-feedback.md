# Restrained pointer feedback

Owner requested subtle grey click/selection feedback instead of excessive circular highlights. Root capture-phase pointerdown/keyboard navigation tracking distinguishes pointer focus restoration (including Radix portals) from genuine keyboard navigation. Pointer-focused controls lose the detached outline/ring; secondary navigation/menu/composer controls use the existing neutral accent surface. Primary send fills, destructive text, disabled states and current selections remain distinct. Keyboard focus-visible rules are unchanged; Tab/arrow/activation navigation restores them immediately. Ordinary typing and IME do not turn a clicked editor into a bright ring.

The base-layer important overrides intentionally outrank older component-layer rings. Account/theme data is not persisted or changed. The local modality listener is removed on unmount. A selected-sidebar CSS specificity conflict is corrected so its existing grey selection survives blur.

Verification: four focused event/cascade contract tests; targeted lint and typecheck; exact-SHA local build and rendered pointer-versus-keyboard checks required before delivery. No live services, deployment or publication.
