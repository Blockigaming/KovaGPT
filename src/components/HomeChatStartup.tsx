import { AudioLines, MessageCircleOff, Mic, PanelLeft, Plus, SquarePen } from "lucide-react";
import { HomeChatFrame } from "@/components/HomeChatFrame";

function HomeChatPlaceholder() {
  return (
    <HomeChatFrame heading={<h1 className="text-balance px-4">Welcome back!</h1>}>
      <div
        className="spec400-chat-input kova-home-composer-placeholder"
        data-composer-surface="empty"
      >
        <div className="spec400-composer">
          <div className="spec400-input-region">
            <div className="spec400-composer-input text-muted-foreground">Work with KovaGPT</div>
          </div>
          <div className="spec400-composer-toolbar">
            <span className="spec400-toolbar-button spec400-toolbar-icon">
              <Plus />
            </span>
            <div className="spec400-composer-trailing">
              <span className="h-7 w-20 rounded-full bg-muted" />
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
    </HomeChatFrame>
  );
}

export function HomeChatContentPending() {
  return (
    <>
      <p className="kova-home-loading" role="status">
        Loading
      </p>
      <div className="kova-phone-home-placeholder" aria-hidden="true" inert>
        <HomeChatPlaceholder />
      </div>
    </>
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
            <div className="flex items-center gap-0.5 opacity-45">
              <span className="grid h-11 w-11 place-items-center">
                <MessageCircleOff className="size-5" />
              </span>
              <span className="grid h-11 w-11 place-items-center">
                <SquarePen className="size-5" />
              </span>
            </div>
          </div>
        </div>
        <HomeChatPlaceholder />
      </div>
    </div>
  );
}
