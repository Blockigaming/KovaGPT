import { AudioLines, Folder, LibraryBig, Mic, Monitor, PanelLeft, Plug, Plus } from "lucide-react";
import { HomeChatFrame } from "@/components/HomeChatStarters";
import { PhoneNavigation } from "@/components/PhoneNavigation";

// Paint the public geometry while account authority is unresolved. This shell
// has no account data, inputs, or active controls.
export function HomeChatStartup() {
  return (
    <div
      className="kova-assistant kova-home-startup flex h-dvh w-full overflow-hidden bg-background"
      data-ui="modern"
      data-kova-home-startup=""
      aria-hidden="true"
      inert
    >
      <aside className="kova-sidebar gap-5 p-4" data-kova-core-sidebar="" data-state="open">
        <strong className="text-xl font-medium">KovaGPT</strong>
        {[0, 1, 2].map((row) => (
          <span key={row} className="h-5 w-2/3 rounded-md bg-muted" />
        ))}
      </aside>
      <div className="kova-chat-main flex min-w-0 flex-1 flex-col bg-background">
        <div className="kova-topbar shrink-0 lg:hidden">
          <div className="kova-topbar-inner grid grid-cols-[44px_minmax(0,1fr)] items-center gap-1 px-2 pb-1">
            <span className="grid h-11 w-11 place-items-center">
              <PanelLeft className="size-5" />
            </span>
            <span className="spec400-mobile-page-title pl-1">KovaGPT</span>
          </div>
        </div>
        <div className="kova-topbar kova-desktop-topbar hidden shrink-0 lg:flex" />
        <HomeChatFrame heading={<h1 className="text-balance px-4">Welcome back!</h1>}>
          <div className="spec400-chat-input" data-composer-surface="empty">
            <div className="spec400-composer">
              <div className="spec400-input-region">
                <div className="spec400-composer-input text-muted-foreground">
                  Work with KovaGPT
                </div>
              </div>
              <div className="spec400-composer-toolbar">
                <span className="spec400-toolbar-button spec400-toolbar-icon">
                  <Plus />
                </span>
                <div className="spec400-composer-trailing">
                  <span className="spec400-toolbar-button spec400-toolbar-icon">
                    <Mic />
                  </span>
                  <span className="spec400-send-button spec400-primary-voice">
                    <AudioLines />
                  </span>
                </div>
              </div>
            </div>
            <div className="kova-composer-tray">
              <span className="kova-composer-tray-action">
                <Folder />
                Choose project
              </span>
              <span className="kova-composer-tray-action">
                <LibraryBig />
                Files
              </span>
              <span className="kova-composer-tray-action">
                <Plug />
                Plugins
              </span>
              <span className="kova-composer-tray-action kova-home-startup-desktop-shortcut">
                <Monitor />
                Open desktop app
              </span>
            </div>
          </div>
        </HomeChatFrame>
        <PhoneNavigation pathname="/" inactive />
      </div>
    </div>
  );
}
