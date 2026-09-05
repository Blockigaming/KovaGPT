import { useEffect, useMemo, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { saveImageToLibrary } from "@/lib/library-images.functions";
import { saveToLibrary } from "@/lib/library.functions";
import {
  createLibraryAttachmentAutoSaver,
  type AttachmentSaveScope,
} from "@/lib/library-attachment-auto-save.mjs";

export function useLibraryAttachmentAutoSave(enabled: boolean, principal: string | null) {
  const saveImage = useServerFn(saveImageToLibrary);
  const saveText = useServerFn(saveToLibrary);
  const mounted = useRef(true);
  const endedScope = useRef<AttachmentSaveScope>({ enabled: false, principal: null });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const scope = useRef<AttachmentSaveScope>({ enabled, principal });
  // Every privacy/principal transition gets a new identity, including switching
  // back. A queued read or toast retry cannot cross that transition.
  if (scope.current.enabled !== enabled || scope.current.principal !== principal) {
    scope.current = { enabled, principal };
  }
  const save = useMemo(
    () =>
      createLibraryAttachmentAutoSaver({
        getScope: () => (mounted.current ? scope.current : endedScope.current),
        saveImage,
        saveText,
        onError: (name, retry) =>
          toast.error(`${name} was attached but could not be saved to your Library.`, {
            action: { label: "Retry save", onClick: () => void retry() },
          }),
      }),
    [saveImage, saveText],
  );
  return { save, scope: scope.current };
}
