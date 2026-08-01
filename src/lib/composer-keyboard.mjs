/**
 * Decide whether a key event should submit the composer.
 *
 * Plain Enter is a desktop pointer preference. Mobile/coarse-pointer Enter
 * always inserts a newline, while Ctrl/Command+Enter remains an explicit,
 * layout-independent submit shortcut. Composition and newline modifiers win.
 */
export function shouldSubmitComposerOnEnter({
  key,
  keyCode = 0,
  shiftKey = false,
  ctrlKey = false,
  metaKey = false,
  altKey = false,
  isComposing = false,
  sendOnEnter = true,
  isMobileLayout = false,
  isCoarsePointer = false,
  hasContent = true,
  disabled = false,
  isStreaming = false,
}) {
  if (key !== "Enter" || keyCode === 229 || isComposing) return false;
  if (disabled || isStreaming || !hasContent || shiftKey || altKey) return false;
  if (ctrlKey || metaKey) return true;
  return sendOnEnter && !isMobileLayout && !isCoarsePointer;
}
