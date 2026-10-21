/** Synthetic browser presentation for the isolated, populated application build. */
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../src/components/ui/dialog";
import { ArrowUpRight, Globe2, Pause, Play, Hand, Square } from "lucide-react";
import "./integrated-browser-preview.css";

export function SampleBrowserThumbnail() {
  return (
    <span
      className="review-browser-page"
      aria-label="Sample page preview: Fieldnotes research journal"
    >
      <span className="review-browser-page-masthead">
        <span>fieldnotes</span>
        <span className="review-browser-page-nav">Journal &nbsp; About</span>
      </span>
      <span className="review-browser-page-story">
        <span className="review-browser-page-copy">
          <span className="review-browser-page-kicker">A FIELD GUIDE TO FOCUS</span>
          <strong>
            A little space
            <br />
            to think.
          </strong>
          <span className="review-browser-page-deck">
            Notes on finding a calmer rhythm
            <br />
            in a connected world.
          </span>
          <span className="review-browser-page-read">
            Read the story <ArrowUpRight aria-hidden="true" />
          </span>
        </span>
        <span className="review-browser-page-art" aria-hidden="true">
          <span className="review-browser-art-sun" />
          <span className="review-browser-art-hill review-browser-art-hill-back" />
          <span className="review-browser-art-hill review-browser-art-hill-front" />
          <span className="review-browser-art-water" />
        </span>
      </span>
      <span className="review-browser-page-caption">
        <span>
          <Globe2 aria-hidden="true" /> fieldnotes.example.invalid
        </span>
        <span className="review-browser-sample-label">Sample</span>
      </span>
    </span>
  );
}

export function IntegratedBrowserDialog({
  session,
  sampleText,
  onTextChange,
  onAction,
  onClose,
  onCloseAutoFocus,
}: {
  session: string;
  sampleText: string;
  onTextChange: (text: string) => void;
  onAction: (action: string) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="review-integrated-browser-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div className="review-integrated-browser-heading">
          <DialogTitle>Cloud browser</DialogTitle>
          <DialogDescription>Sample session · fieldnotes.example.invalid</DialogDescription>
        </div>
        <SampleBrowserThumbnail />
        <p className="review-browser-session-status" role="status">
          <span
            className={`review-browser-status-dot review-browser-status-dot-${session}`}
            aria-hidden="true"
          />
          {session === "owner"
            ? "You have control. Automation is paused."
            : session === "paused"
              ? "Automation paused. No action is in flight."
              : session === "ended"
                ? "Session ended."
                : "Sample automation is active."}
        </p>
        {session === "owner" && (
          <label className="review-browser-input-label">
            Sample page text
            <input
              value={sampleText}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder="Type only sample text"
              autoComplete="off"
              maxLength={500}
            />
          </label>
        )}
        <div className="review-browser-session-actions">
          {session === "active" && (
            <button
              type="button"
              className="review-browser-action-primary"
              onClick={() => onAction("pause")}
            >
              <Pause aria-hidden="true" /> Pause to take over
            </button>
          )}
          {session === "paused" && (
            <>
              <button
                type="button"
                className="review-browser-action-primary"
                onClick={() => onAction("takeover")}
              >
                <Hand aria-hidden="true" /> Take over
              </button>
              <button type="button" onClick={() => onAction("resume")}>
                <Play aria-hidden="true" /> Resume automation
              </button>
            </>
          )}
          {session === "owner" && (
            <button
              type="button"
              className="review-browser-action-primary"
              onClick={() => onAction("release")}
            >
              Return control
            </button>
          )}
          {session !== "ended" && (
            <button type="button" onClick={() => onAction("end")}>
              <Square aria-hidden="true" /> End session
            </button>
          )}
        </div>
        <p className="review-browser-sample-disclosure">
          Sample only. No website is connected. Closing or returning control keeps a paused session
          paused.
        </p>
      </DialogContent>
    </Dialog>
  );
}
