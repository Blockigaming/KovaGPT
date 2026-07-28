# Project Infinity launch polish

## Flagship: Kova Lens

Kova Lens is a universal continuity layer available from every route. Users can select text in a page or editor, press the configurable **Ctrl/Command + Shift + K** shortcut, and continue that selection in Chat, Work, Research, a Context Pack, or Library without manually copying, navigating, and rebuilding context.

Product-truth safeguards:

- Lens does nothing until the user chooses an explicit action.
- Recent captures use session storage and disappear when the browser tab closes.
- Chat handoffs use the existing one-time session handoff.
- Work, Research, and Context Pack actions reuse their existing typed handoff flows.
- Library uses the authenticated server function and reports actual success or failure.
- Selected input and textarea ranges are supported in addition to normal document selection.
- Mobile users have a safe-area-aware 44-pixel launcher and bottom-sheet presentation.

## Productivity and continuity improvements

- Kova Lens is globally mounted, Command Palette discoverable, and keyboard rebindable in Settings.
- Recent captures can be recalled without reselecting or recopying source text.
- The active page title becomes truthful source context for Work, Research, Context Pack, and Library handoffs.
- The Command Palette now executes its previously inert Search workspace and Toggle appearance commands.
- Command execution continues to publish platform events for future approved analytics.

## Remaining launch boundaries

- Cross-device Lens history would require encrypted owner-scoped persistence and user-controlled retention.
- Native share-sheet integration requires signed iOS, Android, and desktop applications.
- Browser clipboard writes depend on secure-context permission.
- Kova Lens intentionally does not invoke AI automatically or send selected text without an explicit destination action.
