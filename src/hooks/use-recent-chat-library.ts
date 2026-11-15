import { useCallback, useEffect, useState, type RefObject } from "react";
import type { RecentLibraryFile } from "@/components/ChatInput";

export function useRecentChatLibrary(
  isLoaded: boolean,
  isSignedIn: boolean | undefined,
  storagePrincipal: string,
  storagePrincipalRef: RefObject<string>,
  storageGenerationRef: RefObject<number>,
  savedLabel: string,
  unavailableMessage: string,
) {
  const [recentLibraryFiles, setRecentLibraryFiles] = useState<RecentLibraryFile[]>([]);
  const [recentLibraryLoading, setRecentLibraryLoading] = useState(false);
  const [recentLibraryError, setRecentLibraryError] = useState<string | null>(null);
  const loadRecentLibraryFiles = useCallback(async () => {
    if (!isLoaded) return;
    const generation = storageGenerationRef.current;
    const requestPrincipal = storagePrincipal;
    const isCurrent = () =>
      generation === storageGenerationRef.current &&
      requestPrincipal === storagePrincipalRef.current;
    setRecentLibraryLoading(true);
    setRecentLibraryError(null);
    try {
      const files = isSignedIn
        ? await (
            await import("@/lib/recent-library-files.mjs")
          ).loadRecentLibraryFileOptions(savedLabel)
        : [];
      if (!isCurrent()) return;
      setRecentLibraryFiles(files);
    } catch (error) {
      if (!isCurrent()) return;
      console.warn("[recentLibraryFiles]", error);
      setRecentLibraryError(unavailableMessage);
    } finally {
      if (isCurrent()) setRecentLibraryLoading(false);
    }
  }, [
    isLoaded,
    isSignedIn,
    storagePrincipal,
    storagePrincipalRef,
    storageGenerationRef,
    savedLabel,
    unavailableMessage,
  ]);

  useEffect(() => {
    void loadRecentLibraryFiles();
  }, [loadRecentLibraryFiles]);

  const resetRecentLibrary = useCallback(() => {
    setRecentLibraryFiles([]);
    setRecentLibraryLoading(false);
    setRecentLibraryError(null);
  }, []);
  return {
    recentLibraryFiles,
    recentLibraryLoading,
    recentLibraryError,
    loadRecentLibraryFiles,
    resetRecentLibrary,
  };
}
