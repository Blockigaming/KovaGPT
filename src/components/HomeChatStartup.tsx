import { AudioLines, Mic, PanelLeft, Plus, SquarePen } from "lucide-react";
import { ChatLoadingIndicator } from "@/components/StreamingStatus";
import { HomeChatFrame } from "@/components/HomeChatFrame";
import { TemporaryChatIcon } from "./TemporaryChatIcon";

function HomeChatPlaceholder() {
  return (
    <HomeChatFrame heading="Welcome back!">
      <div
        className="spec400-chat-input kova-home-composer-placeholder"
        data-composer-surface="empty"
      >
        <div className="spec400-composer">
          <div className="spec400-input-region">
            <div className="spec400-composer-input">
              <span className="h-2 w-28 rounded-full bg-muted-foreground/20" />
            </div>
          </div>
          <div className="spec400-composer-toolbar">
            <div className="spec400-composer-tools">
              <span className="spec400-toolbar-button spec400-toolbar-icon">
                <Plus />
              </span>
            </div>
            <div className="spec400-composer-trailing">
              <span className="kova-home-model-placeholder flex items-center">
                <span className="h-7 w-20 rounded-full bg-muted" />
              </span>
              <div className="spec400-composer-speech-actions">
                <span className="spec400-toolbar-button spec400-toolbar-icon">
                  <Mic />
                </span>
                <span className="spec400-send-button spec400-primary-voice">
                  <AudioLines />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </HomeChatFrame>
  );
}

// Paint the public geometry while account authority is unresolved. This shell
// has no account data, inputs, or active controls.
export function HomeChatStartup() {
  return (
    <div
      className="kova-assistant kova-home-startup flex h-dvh w-full overflow-hidden bg-background"
      data-ui="modern"
      data-kova-home-startup=""
      data-compact-chat-home="true"
      aria-hidden="true"
      inert
    >
      <div className="kova-chat-main flex min-w-0 flex-1 flex-col bg-background">
        <div className="kova-topbar shrink-0 lg:hidden">
          <div className="kova-topbar-inner grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-1 px-2 pb-1">
            <span className="grid h-11 w-11 place-items-center">
              <PanelLeft className="size-5" />
            </span>
            <span className="spec400-mobile-page-title pl-1">KovaGPT</span>
            <div className="kova-mobile-home-actions flex items-center gap-0.5 opacity-45">
              <span className="grid h-11 w-11 place-items-center">
                <TemporaryChatIcon className="size-5" />
              </span>
              <span className="grid h-11 w-11 place-items-center">
                <SquarePen className="size-5" />
              </span>
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-14 z-10">
          <ChatLoadingIndicator transcript />
        </div>
        <HomeChatPlaceholder />
      </div>
    </div>
  );
}
