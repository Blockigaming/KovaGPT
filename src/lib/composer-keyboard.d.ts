export type ComposerKeyboardEvent = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  sendOnEnter?: boolean;
  isMobileLayout?: boolean;
};

export function shouldSubmitComposerOnEnter(options: ComposerKeyboardEvent): boolean;
