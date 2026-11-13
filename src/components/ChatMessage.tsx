import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { normalizeResponseFollowups } from "@/lib/response-followups.mjs";
import "./response-action-refinement.css";
import "./prompt-activity.css";
import { PromptMessage } from "./PromptMessage";
import { StreamingStatus } from "./StreamingStatus";
import { SafeResponseAdvertisement } from "./SafeResponseAdvertisement";
import { MessageActivityList } from "./MessageActivityList";
import { normalizeMemorySources } from "@/lib/memory-sources.mjs";
import { ResponseMarkdown } from "./ResponseMarkdown";
import { TaskCreatedBubble } from "./TaskCreatedBubble";
import { HistoricalLibraryAttachment } from "./HistoricalLibraryAttachment";
import { ChatImage, type ChatImageActions } from "./ChatImage";
import { prepareChatImageAttachment } from "@/lib/chat-image-actions";
import type { ResultDescriptor } from "./ArtifactEditor";
import { splitGenerativeContent, type GenerativeWidget } from "@/lib/generative-ui.mjs";
import { GenerativeCanvas } from "./generative-ui/GenerativeCanvas";
import { splitInteractiveContent } from "@/lib/interactive-ui.mjs";
import { InteractiveBlock } from "./interactive-ui/InteractiveBlock";
import {
  Copy,
  Sparkles,
  Check,
  ImageIcon,
  Loader2,
  Bookmark,
  Brain,
  FileEdit,
  Code2,
  MoreHorizontal,
  Share2,
  Pencil,
  RefreshCw,
  GitBranch,
  Globe,
  Mail,
  FileText,
  ThumbsUp,
  ThumbsDown,
  History,
  TextSelect,
  GraduationCap,
} from "lucide-react";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MobileBottomSheet } from "./MobileBottomSheet";
import { ResponseSpeechButton } from "./ResponseSpeechButton";
import { useLayout } from "@/hooks/use-mobile";
import { useTimeFormatPreference } from "@/hooks/use-time-format-preference";
import { formatDisplayDateTime } from "@/lib/time-format";
import { normalizeSourceRetrievedAt } from "@/lib/response-source-time.mjs";
import type { Message } from "@/lib/chat-store";
import { extractCharts } from "./chat-chart-utils";
import { extractEmailFromMessage, openEmailCompose } from "./message-action-utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveImageToLibrary } from "@/lib/library-images.functions";
import { deleteLibraryItem, findResponseBookmark, saveToLibrary } from "@/lib/library.functions";
import { getResponseFeedbackBatch, submitResponseFeedback } from "@/lib/feedback.functions";
import { loadResponseFeedbackBatched } from "@/lib/feedback-batch";
import { useUser } from "@/components/auth/ClerkSafe";
import { detectArtifactKind, extractCodeBlocks } from "./artifact-utils";
import { ToolConfirmCard } from "./ToolConfirmCard";
import type { PendingConfirm } from "@/lib/chat-store";
import { InfoChip } from "./InfoChip";
import { detectInfoChip } from "./info-chip-utils";
import {
  browserStoragePrincipal,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  principalScopedStorageKey,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

const MemorySourcesDialog = lazy(() =>
  import("./MemorySourcesDialog").then(({ MemorySourcesDialog }) => ({
    default: MemorySourcesDialog,
  })),
);
const ChatChart = lazy(() =>
  import("./ChatChart").then(({ ChatChart }) => ({ default: ChatChart })),
);
const ArtifactEditor = lazy(() =>
  import("./ArtifactEditor").then(({ ArtifactEditor }) => ({ default: ArtifactEditor })),
);
const SelectionEditDialog = lazy(() =>
  import("./SelectionEditDialog").then(({ SelectionEditDialog }) => ({
    default: SelectionEditDialog,
  })),
);
const ChatStudyControl = lazy(() =>
  import("./ChatStudyControl").then(({ ChatStudyControl }) => ({ default: ChatStudyControl })),
);
const MessageVersionHistoryDialog = lazy(() =>
  import("./MessageVersionHistoryDialog").then(({ MessageVersionHistoryDialog }) => ({
    default: MessageVersionHistoryDialog,
  })),
);

function cleanAssistantText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function ChatMessagePLACEHOLDER_NEED_FULL_FILE() {
  return null;
}
