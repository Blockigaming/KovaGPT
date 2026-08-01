export type ComposerKeyboardEvent = {
  key: string;
  keyCode?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  sendOnEnter?: boolean;
  isMobileLayout?: boolean;
  isCoarsePointer?: boolean;
  hasContent?: boolean;
  disabled?: boolean;
  isStreaming?: boolean;
};

export function shouldSubmitComposerOnEnter(options: ComposerKeyboardEvent): boolean;
