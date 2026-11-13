import { readChatDeleteIntents, subscribeChatDeleteIntents } from "@/lib/chat-delete-undo";
import { resumePendingChatDeletions } from "@/lib/permanent-chat-delete";
import {
  NewChatGlyph,
  LibraryGlyph,
  ProjectsGlyph,
  TasksGlyph,
  PluginsGlyph,
  SearchGlyph,
  SettingsGlyph,
  MoreGlyph,
  CustomizeGlyph,
  type SidebarGlyph,
} from "@/components/SidebarIcons";
import {
  Archive,
  Brain,
  Heart,
  CreditCard,
  Bell,
  PanelLeft,
  ArrowLeft,
  MessageSquare,
  ChevronDown,
  LogOut,
  Map,
  CircleHelp,
  Copy as CopyIcon,
  Ellipsis,
  Pin,
  PinOff,
  Pencil,
  Settings as SettingsIcon,
  Share2,
  Sparkles,
  Trash2,
  X,
  UserRound,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAccountProfile } from "@/lib/use-account-profile";
import { SignInButton, useClerkSafe, useUser } from "@/components/auth/ClerkSafe";
import { LogoutConfirmDialog } from "@/components/LogoutConfirmDialog";
import { NovaLogo } from "@/components/NovaLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatProjectSubmenu } from "@/components/ChatProjectSubmenu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatReplyActivity } from "@/hooks/useChatReplyActivity";
import { useTier } from "@/hooks/useTier";
import type { Conversation } from "@/lib/chat-store";
import { searchConversations } from "@/lib/conversation-search";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";
import { type SidebarShortcutId } from "@/lib/sidebar-shortcuts.mjs";
import {
  DEFAULT_SIDEBAR_LAYOUT,
  SIDEBAR_ITEMS,
  readSidebarLayout,
  saveSidebarLayout,
  sidebarLayoutKey,
  clampSidebarWidth,
  sidebarColors,
  type SidebarLayout,
} from "@/lib/sidebar-layout.mjs";
import "@/styles/sidebar-personalization.css";
import { requestDrawerNavigationFocus } from "@/lib/drawer-navigation-focus";
import { isClearSidebarSwipe } from "@/lib/sidebar-swipe.mjs";

const SHORTCUT_ICONS: Record<SidebarShortcutId, SidebarGlyph> = {
  library: LibraryGlyph,
  projects: ProjectsGlyph,
  "scheduled-tasks": TasksGlyph,
  apps: PluginsGlyph,
  health: Heart,
  finances: CreditCard,
  maps: Map,
  memory: Brain,
  settings: SettingsGlyph,
  notifications: Bell,
};

// NOTE: Full file body continues from previous good version - this is a temporary partial restore marker that must be replaced.
export function Sidebar() {
  return null;
}
