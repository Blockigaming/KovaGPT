import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { clearConversations } from "@/lib/chat-store";
import { getUsage, DAILY_IMAGE_LIMIT, DAILY_UPLOAD_LIMIT } from "@/lib/limits";

export type Settings = {
  autoSpeak: boolean;
  voiceRate: number;
};

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  onClearAll,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: Settings;
  onChange: (s: Settings) => void;
  onClearAll: () => void;
}) {
  const usage = open ? getUsage() : { images: 0, uploads: 0, date: "" };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section>
            <h3 className="text-sm font-semibold mb-3">Voice</h3>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">Auto-read responses</div>
                <div className="text-xs text-muted-foreground">Speak replies out loud automatically</div>
              </div>
              <Switch
                checked={settings.autoSpeak}
                onCheckedChange={(v) => onChange({ ...settings, autoSpeak: v })}
              />
            </div>
            <div className="mt-4">
              <div className="text-sm mb-2">Speech rate: {settings.voiceRate.toFixed(1)}x</div>
              <Slider
                min={0.5}
                max={2}
                step={0.1}
                value={[settings.voiceRate]}
                onValueChange={(v) => onChange({ ...settings, voiceRate: v[0] })}
              />
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-3">Daily Usage (Free)</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Images generated</span>
                <span>
                  {usage.images} / {DAILY_IMAGE_LIMIT}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Images uploaded</span>
                <span>
                  {usage.uploads} / {DAILY_UPLOAD_LIMIT}
                </span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-3">Data</h3>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                clearConversations();
                onClearAll();
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear all conversations
            </Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
