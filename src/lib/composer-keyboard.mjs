/**
 * Decide whether an Enter key event should submit the composer.
 *
 * Plain Enter is a desktop preference. Mobile Enter always inserts a newline,
 * while Ctrl/Command+Enter remains an explicit, layout-independent submit
 * shortcut. Composition and newline modifiers always win.
 */
export function shouldSubmitComposerOnEnter({
  key,
  shiftKey = false,
  ctrlKey = false,
  metaKey = false,
  altKey = false,
  isComposing = false,
  sendOnEnter = true,
  isMobileLayout = false,
}) {
  if (key !== "Enter" || isComposing || shiftKey || altKey) return false;
  if (ctrlKey || metaKey) return true;
  return sendOnEnter && !isMobileLayout;
}
