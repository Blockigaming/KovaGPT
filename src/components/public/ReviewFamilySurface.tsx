import { Link } from "@tanstack/react-router";
import { Circle, Pause, Waves } from "lucide-react";
import type { RefObject } from "react";
import type { ReviewPage } from "@/lib/review-page-content";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ReviewDraft = {
  title: string;
  notes: string;
  audience: string;
  mode: string;
  ratio: string;
  language: string;
  speed: string;
  checked: string[];
  referenceRole: string;
  quality: string;
  audio: boolean;
  retentionDays: string;
  retentionScope: string;
  memberLabel: string;
  role: string;
  sharingPolicy: string;
  adjustment: string;
  apiInput: string;
  apiOutput: string;
  apiValidation: string;
};
type Props = {
  page: ReviewPage;
  draft: ReviewDraft;
  update: <K extends keyof ReviewDraft>(key: K, value: ReviewDraft[K]) => void;
  reference: { name: string; url: string } | null;
  referenceInputRef: RefObject<HTMLInputElement | null>;
  setReference: (value: { name: string; url: string } | null) => void;
  setStatus: (message: string) => void;
  call: "idle" | "preview" | "paused";
  setCall: (value: "idle" | "preview" | "paused") => void;
};
const legalSubjects: Record<string, string[]> = {
  "legal-baa": [
    "Covered parties and permitted use",
    "Handling and disclosure requirements",
    "Incident reporting and termination",
  ],
  "legal-data-processing-addendum": [
    "Controller and processor roles",
    "Processing purpose and data categories",
    "Deletion, transfer and subprocessor provisions",
  ],
  "legal-subprocessor-list": [
    "Verified provider identities",
    "Processing purpose and locations",
    "Change-notification procedure",
  ],
  "legal-cookie-policy": [
    "Actual cookies and storage used",
    "Necessary and optional purposes",
    "Available consent and withdrawal controls",
  ],
  "legal-brand-guidelines": [
    "Approved logo assets and proportions",
    "Permitted identity usage",
    "Trademark permission and attribution",
  ],
  "legal-law-enforcement": [
    "Verified requesting authority",
    "Applicable process and jurisdiction",
    "Authorized disclosure review",
  ],
};
const mediaGuidance: Record<string, [string, string]> = {
  "media-photo-edit": ["Editing instruction", "Describe the specific part of the photo to change."],
  "media-ecommerce-listing": [
    "Listing composition",
    "Describe the product, framing and required background.",
  ],
  "media-hero-product-reveal": [
    "Reveal sequence",
    "Describe the opening, reveal and closing frames.",
  ],
  "media-living-sprite": ["Character poses", "List the poses or expressions needed."],
  "media-mascot-maker": ["Character direction", "Describe the character shape and personality."],
  "media-aspect-ratio": [
    "Framing instruction",
    "Describe what must remain visible in the new frame.",
  ],
  "media-profile-picture": ["Profile framing", "Describe framing, background and expression."],
  "media-product-color-change": [
    "Requested color change",
    "Name the product area and intended color.",
  ],
  "media-ugc-photos": ["Scene direction", "Describe the setting and candid composition."],
  "media-professional-headshot": [
    "Portrait direction",
    "Describe framing, lighting and background.",
  ],
  "media-restyle": ["Style direction", "Describe the intended visual treatment."],
  "media-background-removal": [
    "Background treatment",
    "Describe what should stay and whether the background should be removed or replaced.",
  ],
  "media-collage": ["Collage arrangement", "Describe the arrangement and spacing."],
  "media-icon-maker": ["Icon direction", "Describe the symbol and intended display size."],
  "media-emoji-creator": ["Expression", "Describe the emotion and recognizable features."],
  "media-editorial-poster": ["Poster message", "Describe the headline, subject and hierarchy."],
  "media-text-edit": ["Text replacement", "Write the text to replace and the desired wording."],
  "media-precise-edit": ["Targeted edit", "Identify the exact area and change."],
  "media-loop": ["Loop transition", "Describe how the final frame should connect to the first."],
};
export function ReviewFamilySurface({
  page,
  draft,
  update,
  reference,
  referenceInputRef,
  setReference,
  setStatus,
  call,
  setCall,
}: Props) {
  const select = (label: string, key: keyof ReviewDraft, options: string[]) => (
    <label>
      {label}
      <Select value={String(draft[key])} onValueChange={(value) => update(key, value as never)}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((value) => (
            <SelectItem key={value} value={value}>
              {value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
  const input = (label: string, key: "title" | "memberLabel" | "retentionDays", type = "text") => (
    <label>
      {label}
      <input
        type={type}
        min={type === "number" ? 1 : undefined}
        value={draft[key]}
        onChange={(e) => update(key, e.target.value)}
      />
    </label>
  );
  const notes = (label: string, placeholder: string) => (
    <label>
      {label}
      <textarea
        rows={5}
        value={draft.notes}
        onChange={(e) => update("notes", e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
  if (page.family === "legal")
    return (
      <article
        className="spec400-review-card spec400-document-status"
        data-family-surface="legal-reading"
      >
        <p className="spec400-eyebrow">Document availability</p>
        <h2>No approved document supplied</h2>
        <p>
          This destination does not provide operative {page.title.toLowerCase()}. No terms are
          accepted, and no rights or obligations are defined by this review page.
        </p>
        <dl className="spec400-facts">
          <div>
            <dt>Document</dt>
            <dd>{page.title}</dd>
          </div>
          <div>
            <dt>Publication status</dt>
            <dd>Not supplied for this review</dd>
          </div>
          <div>
            <dt>Version and effective date</dt>
            <dd>Not established</dd>
          </div>
          <div>
            <dt>Applicable scope</dt>
            <dd>Requires verified Kova-owned source</dd>
          </div>
        </dl>
        <h3>What a complete document needs to address</h3>
        <ul>
          {(
            legalSubjects[page.slug] ?? [
              "The specific service and contracting parties",
              "Applicable scope, jurisdiction and effective date",
              "Approved obligations, exceptions and contact process",
            ]
          ).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>This list identifies review topics. It is not substitute legal text.</p>
        <nav className="spec400-review-actions" aria-label="Existing policy documents">
          <Link to="/terms">Read existing Terms</Link>
          <Link to="/privacy">Read Privacy information</Link>
          <Link to={"/policies" as never}>Open policy directory</Link>
        </nav>
      </article>
    );
  if (page.family === "voice")
    return (
      <div className="spec400-review-columns" data-family-surface="voice-call">
        <section className="spec400-review-card spec400-call-surface">
          <p className="spec400-eyebrow">Text-only interface preview</p>
          <h2>Call preview</h2>
          <div className="spec400-call-indicator" aria-hidden="true">
            {call === "idle" ? (
              <Circle size={48} />
            ) : call === "paused" ? (
              <Pause size={48} />
            ) : (
              <Waves size={48} />
            )}
          </div>
          <p role="status">
            {call === "idle"
              ? "Preview stopped. Microphone is off."
              : call === "paused"
                ? "Preview paused. No audio was recorded."
                : "Preview open. No call or recording is active."}
          </p>
          <div className="spec400-review-actions">
            <button data-review-call-start onClick={() => setCall("preview")}>
              Start text preview
            </button>
            <button
              disabled={call === "idle"}
              onClick={() => setCall(call === "paused" ? "preview" : "paused")}
            >
              {call === "paused" ? "Resume preview" : "Pause preview"}
            </button>
            <button
              disabled={call === "idle"}
              onClick={(event) => {
                setCall("idle");
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>("[data-review-call-start]")
                  ?.focus();
              }}
            >
              End preview
            </button>
          </div>
          {call !== "idle" && (
            <p className="spec400-transcript">
              {draft.notes || "Example transcript: What would you like to work on today?"}
            </p>
          )}
          <p>No microphone permission, audio playback or call provider is available.</p>
        </section>
        <section className="spec400-review-card">
          <h2>Preview preferences</h2>
          {select("Voice style example", "mode", ["Calm example", "Clear example"])}
          {select("Language label example", "language", ["English", "French", "Spanish"])}
          {select("Speaking-speed label", "speed", ["Slow", "Normal", "Fast"])}
          <p>
            These labels demonstrate preference controls; they do not identify supported voices or
            languages.
          </p>
          {notes("Text for the preview", "Type an example sentence.")}
        </section>
      </div>
    );
  if (page.family === "media") {
    const video = ["media-video", "media-loop", "media-hero-product-reveal"].includes(page.slug);
    const guidance = mediaGuidance[page.slug] ?? [
      "Composition direction",
      "Describe the intended composition.",
    ];
    return (
      <div
        className="spec400-review-columns spec400-media-layout"
        data-family-surface="media-composition"
      >
        <section className="spec400-review-card">
          <h2>{reference ? "Reference composition" : "Choose a reference"}</h2>
          <div
            className="spec400-composition spec400-composition-large"
            data-empty={!reference}
            style={reference ? { aspectRatio: draft.ratio.replace(":", "/") } : undefined}
          >
            {reference ? (
              <img src={reference.url} alt={`Unedited reference: ${reference.name}`} />
            ) : (
              <span>
                No reference selected
                <br />
                {draft.ratio} layout guide
              </span>
            )}
          </div>
          <label>
            Open image on this device
            <input
              ref={referenceInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!file.type.startsWith("image/")) {
                  setStatus("Choose an image file.");
                  return;
                }
                try {
                  setReference({ name: file.name, url: URL.createObjectURL(file) });
                  setStatus("Reference opened locally. No upload occurred.");
                } catch {
                  setStatus("Reference preview could not open. Your instructions are unchanged.");
                }
              }}
            />
          </label>
          {reference && (
            <div>
              <p>{reference.name}</p>
              <button
                onClick={(event) => {
                  const input = event.currentTarget
                    .closest("section")
                    ?.querySelector<HTMLInputElement>('input[type="file"]');
                  setReference(null);
                  setStatus("Local reference removed. Your instructions are unchanged.");
                  if (input) {
                    input.value = "";
                    input.focus();
                  }
                }}
              >
                Remove local reference
              </button>
            </div>
          )}
          <p>
            Unedited source preview only. Nothing is uploaded, generated or published. Image
            references are not included in saved drafts.
          </p>
        </section>
        <section className="spec400-review-card">
          <h2>{video ? "Sequence settings" : "Composition settings"}</h2>
          {select("Aspect ratio", "ratio", ["1:1", "2:3", "3:2", "16:9", "9:16"])}
          <label>
            {guidance[0]}
            <textarea
              rows={5}
              value={draft.adjustment}
              onChange={(e) => update("adjustment", e.target.value)}
              placeholder={guidance[1]}
            />
          </label>
          {video && (
            <>
              {select("Frame role proposal", "referenceRole", [
                "Reference",
                "First frame",
                "Last frame",
                "Loop",
              ])}
              {select("Output quality proposal", "quality", [
                "Original preview",
                "720p proposal",
                "1080p proposal",
              ])}
              <label className="spec400-check">
                <input
                  type="checkbox"
                  checked={draft.audio}
                  onChange={(e) => update("audio", e.target.checked)}
                />
                <span>Include audio in brief</span>
              </label>
              <p>Video processing, upscaling, looping and audio are unavailable.</p>
            </>
          )}
          <div className="spec400-review-notice">
            <strong>{video ? "Video generation unavailable" : "Image editing unavailable"}</strong>
            <p>
              Keep the composition instructions here. Supported image tools remain in the existing
              workspace.
            </p>
            <Link to="/images">Open Images</Link>
          </div>
        </section>
      </div>
    );
  }
  if (page.family === "team") {
    const retention = page.slug === "team-retention";
    const sharing = page.slug === "team-sharing";
    const usage = page.slug === "team-usage";
    return (
      <div
        className={usage ? undefined : "spec400-review-columns"}
        data-family-surface="team-policy"
      >
        <section className="spec400-review-card">
          <h2>
            {retention
              ? "Retention policy proposal"
              : sharing
                ? "Sharing policy proposal"
                : usage
                  ? "Team usage"
                  : "Workspace access proposal"}
          </h2>
          {usage ? (
            <>
              <p>No team usage source is connected to this review.</p>
              <dl className="spec400-facts">
                <div>
                  <dt>Reporting period</dt>
                  <dd>Unavailable</dd>
                </div>
                <div>
                  <dt>Member usage</dt>
                  <dd>Unavailable</dd>
                </div>
                <div>
                  <dt>License allocation</dt>
                  <dd>Unavailable</dd>
                </div>
              </dl>
              <Link to={"/organization" as never}>Open organization workspace</Link>
            </>
          ) : retention ? (
            <>
              {select("Content scope", "retentionScope", [
                "Not selected",
                "Conversations proposal",
                "Files proposal",
                "Run outputs proposal",
              ])}
              {input("Proposed retention period in days", "retentionDays", "number")}
              <p>
                No default or permitted retention period is implied. An administrator must validate
                the policy.
              </p>
            </>
          ) : sharing ? (
            <>
              {select("Proposed sharing boundary", "sharingPolicy", [
                "Not selected",
                "Private by default proposal",
                "Team-only proposal",
                "External sharing disabled proposal",
              ])}
              {select("Proposed approval role", "role", [
                "Not selected",
                "Administrator proposal",
                "Owner proposal",
              ])}
            </>
          ) : (
            <>
              {input("Example workspace or member label", "memberLabel")}
              {select("Proposed role", "role", [
                "Not selected",
                "Viewer proposal",
                "Contributor proposal",
                "Administrator proposal",
              ])}
              {select("Proposed sharing boundary", "sharingPolicy", [
                "Not selected",
                "Private by default proposal",
                "Team-only proposal",
              ])}
              <p>No member is invited or assigned a license.</p>
            </>
          )}
        </section>
        {!usage && (
          <section className="spec400-review-card">
            <h2>Proposed change summary</h2>
            <p>This is a local proposal. No organization policy is active or changed.</p>
            <dl className="spec400-facts">
              {retention ? (
                <>
                  <div>
                    <dt>Scope</dt>
                    <dd>{draft.retentionScope}</dd>
                  </div>
                  <div>
                    <dt>Retention period</dt>
                    <dd>
                      {draft.retentionDays
                        ? Number.isInteger(Number(draft.retentionDays)) &&
                          Number(draft.retentionDays) > 0
                          ? `${draft.retentionDays} days proposed`
                          : "Enter a positive whole number"
                        : "Not specified"}
                    </dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt>Example label</dt>
                    <dd>{draft.memberLabel || "Not specified"}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{draft.role}</dd>
                  </div>
                  <div>
                    <dt>Sharing</dt>
                    <dd>{draft.sharingPolicy}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Service status</dt>
                <dd>No organization connected</dd>
              </div>
            </dl>
          </section>
        )}
      </div>
    );
  }
  if (page.family === "assistant") {
    const teaching = page.slug === "assistant-teach";
    const computer = page.slug === "assistant-computer";
    const routine = page.slug === "assistant-routines";
    if (page.slug === "assistant-notifications")
      return (
        <section className="spec400-review-card" data-family-surface="assistant-notifications">
          <h2>Notification service unavailable</h2>
          <p>No assistant notification service is connected. No notifications have been sent.</p>
          <p>
            Delivery preferences and history will require a configured service. This review does not
            request browser notification permission.
          </p>
        </section>
      );
    const conversation = ["assistant-conversation", "assistant-details"].includes(page.slug);
    const shared = page.slug === "assistant-shared-output";
    return (
      <div
        className={!computer && !shared ? "spec400-review-columns" : undefined}
        data-family-surface="assistant-configuration"
      >
        <section className="spec400-review-card">
          <h2>
            {computer
              ? "Computer connection"
              : teaching
                ? "Write task steps"
                : routine
                  ? "Routine proposal"
                  : conversation
                    ? "Conversation preview"
                    : shared
                      ? "Shared output status"
                      : "Assistant configuration"}
          </h2>
          {computer ? (
            <>
              <div className="spec400-empty-display">No computer connected</div>
              <p>Screen access and remote control are unavailable in this review.</p>
            </>
          ) : shared ? (
            <>
              <p>No published output is selected.</p>
              <p>
                PDF export and owner share controls require an actual supported output. Local review
                notes can be exported as JSON from Review tools below.
              </p>
            </>
          ) : (
            <>
              {!teaching && !conversation && input("Assistant or routine name", "title")}
              {routine &&
                select("Proposed trigger", "mode", [
                  "Manual preview",
                  "Daily proposal · not scheduled",
                  "Email proposal · not connected",
                ])}
              {!teaching &&
                !conversation &&
                select("Intended access", "audience", [
                  "Private local preview",
                  "Team proposal · not shared",
                  "Public proposal · not published",
                ])}
              {notes(
                teaching
                  ? "Task steps, one per line"
                  : conversation
                    ? "Example message"
                    : "Instructions",
                teaching
                  ? "Describe each step manually. No screen recording occurs."
                  : "Use example information only.",
              )}
            </>
          )}
        </section>
        {!computer && !shared && (
          <section className="spec400-review-card">
            <h2>
              {teaching
                ? "Step preview"
                : routine
                  ? "Routine summary"
                  : conversation
                    ? "Example conversation"
                    : "Availability and preview"}
            </h2>
            {draft.notes ? (
              <ol>
                {draft.notes
                  .split("\n")
                  .filter(Boolean)
                  .map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
              </ol>
            ) : (
              <p>
                {teaching
                  ? "Add steps to preview the procedure."
                  : conversation
                    ? "No conversation is running."
                    : "No local instructions entered."}
              </p>
            )}
            {routine && <p>{draft.mode}. Nothing is scheduled.</p>}
            <p>
              {teaching
                ? "Teach-a-task recording is unavailable. These manually written steps are not executed."
                : "Skills, computer access, templates and notifications require configured services. This preview does not run or publish an assistant."}
            </p>
          </section>
        )}
      </div>
    );
  }
  if (page.family === "infrastructure")
    return (
      <section className="spec400-review-card" data-family-surface="infrastructure-evidence">
        <h2>Infrastructure disclosure status</h2>
        <p>No deployment evidence is supplied for public infrastructure claims.</p>
        <dl className="spec400-facts">
          {[
            "Capacity",
            "Regions and operators",
            "Availability measurements",
            "Security certifications",
          ].map((label) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>Verified source required</dd>
            </div>
          ))}
        </dl>
        <h3>Evidence to obtain</h3>
        <p>
          Each claim needs an accountable owner, a dated source and approval for publication. This
          page makes no capacity or certification claim.
        </p>
        <Link to={"/security" as never}>Read existing security information</Link>
      </section>
    );
  if (page.slug === "api-imagine")
    return (
      <div className="spec400-review-columns" data-family-surface="media-api-brief">
        <section className="spec400-review-card">
          <h2>Media integration brief</h2>
          <p>
            Describe the integration before choosing a verified API. This local brief sends no
            requests.
          </p>
          {(
            [
              [
                "apiInput",
                "Input and source rights",
                "Describe the source format and permission to use it.",
              ],
              [
                "apiOutput",
                "Desired output",
                "Describe the output format, dimensions and intended use.",
              ],
              [
                "apiValidation",
                "Validation and recovery",
                "Describe the quality checks, failure handling and human review.",
              ],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key}>
              {label}
              <textarea
                rows={3}
                value={draft[key]}
                placeholder={placeholder}
                onChange={(event) => update(key, event.target.value)}
              />
            </label>
          ))}
        </section>
        <section className="spec400-review-card">
          <h2>Local integration summary</h2>
          <dl className="spec400-review-facts">
            <div>
              <dt>Input</dt>
              <dd>{draft.apiInput || "Not specified"}</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>{draft.apiOutput || "Not specified"}</dd>
            </div>
            <div>
              <dt>Validation</dt>
              <dd>{draft.apiValidation || "Not specified"}</dd>
            </div>
          </dl>
          <p>
            Endpoint, supported models, authentication and pricing must be verified before
            implementation. No executable request is generated here.
          </p>
          <div className="spec400-review-actions">
            <Link to={"/developers" as never}>Developer documentation</Link>
            <Link to={"/work" as never}>Existing Work workspace</Link>
          </div>
        </section>
      </div>
    );
  if (page.family === "developer")
    return (
      <section className="spec400-review-card" data-family-surface="technical-planning">
        <h2>Format and validation requirements</h2>
        <p>
          The requested editor or integration is not connected. Define the inputs and expected
          result before selecting a supported tool.
        </p>
        {notes(
          "Technical requirements",
          "Describe input format, expected output and validation steps.",
        )}
        <div className="spec400-review-actions">
          <Link to={"/developers" as never}>Developer documentation</Link>
          <Link to={"/work" as never}>Existing Work workspace</Link>
        </div>
      </section>
    );
  return (
    <section className="spec400-review-card" data-family-surface="request-preparation">
      <h2>
        {page.slug === "sales-request"
          ? "Outline your requirements"
          : page.slug === "privacy-request"
            ? "Prepare a privacy question"
            : "Plan the workflow"}
      </h2>
      {notes(
        "Request or workflow outline",
        "Use example information. Do not include account credentials or sensitive details.",
      )}
      <p>
        No request is submitted. Verify the recipient and exact contents before using a connected
        contact channel.
      </p>
      <Link to={"/contact-support" as never}>View existing contact options</Link>
    </section>
  );
}
