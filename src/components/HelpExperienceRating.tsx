import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getResponseFeedbackBatch, submitResponseFeedback } from "@/lib/feedback.functions";
import {
  noticeIsDismissed,
  rememberNoticeDismissal,
} from "@/lib/notification-dismissal-policy.mjs";
import { safeBrowserStorage } from "@/lib/principal-browser-storage.mjs";

const ratingKey = "help-center-experience-v1";
const dismissal = { id: "rating_requested", group: "feedback", campaignId: ratingKey };
type FeedbackState =
  | "loading"
  | "rating"
  | "rating-error"
  | "saved"
  | "survey"
  | "survey-error"
  | "survey-saved"
  | "hidden";

export function HelpExperienceRating({
  ownerId,
  questionId,
}: {
  ownerId: string;
  questionId: string;
}) {
  const load = useServerFn(getResponseFeedbackBatch);
  const save = useServerFn(submitResponseFeedback);
  const [state, setState] = useState<FeedbackState>("loading");
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const scope = useRef<{ mounted: boolean; saving: boolean } | null>(null);
  useEffect(() => {
    const lifetime = { mounted: true, saving: false };
    scope.current = lifetime;
    const storage = safeBrowserStorage("localStorage");
    if (!storage || noticeIsDismissed(storage, { ...dismissal, accountId: ownerId })) {
      setState("hidden");
    } else {
      void load({ data: { expectedOwnerId: ownerId, messageIds: [ratingKey] } })
        .then((response) => {
          if (!lifetime.mounted) return;
          const ratings = response?.ratings;
          const unrated =
            ratings &&
            typeof ratings === "object" &&
            !Array.isArray(ratings) &&
            !(ratingKey in ratings);
          setState(unrated ? "rating" : "hidden");
        })
        .catch(() => {
          if (lifetime.mounted) setState("hidden");
        });
    }
    return () => {
      lifetime.mounted = false;
    };
  }, [load, ownerId]);

  const returnFocus = () => document.getElementById(questionId)?.focus({ preventScroll: true });
  const rate = async (rating: "up" | "down", contextExcerpt?: string) => {
    const lifetime = scope.current;
    if (!lifetime?.mounted || lifetime.saving) return;
    lifetime.saving = true;
    const survey = contextExcerpt !== undefined;
    setBusy(true);
    try {
      const result = await save({
        data: {
          expectedOwnerId: ownerId,
          messageId: ratingKey,
          rating,
          ...(survey ? { contextExcerpt } : {}),
        },
      });
      if (!lifetime.mounted) return;
      if (result.saved !== true) throw Error("Rating not saved");
      if (survey) setState("survey-saved");
      else setState(rating === "down" ? "survey" : "saved");
      returnFocus();
    } catch {
      if (lifetime.mounted) setState(survey ? "survey-error" : "rating-error");
    } finally {
      lifetime.saving = false;
      if (lifetime.mounted) setBusy(false);
    }
  };

  if (state === "loading" || state === "hidden") return null;
  if (state === "saved" || state === "survey-saved")
    return (
      <p className="mt-3 text-sm text-muted-foreground" role="status">
        {state === "survey-saved" ? "Feedback saved" : "Rating saved"}
      </p>
    );

  if (state === "survey" || state === "survey-error") {
    const fieldId = `${questionId}-survey`;
    return (
      <>
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Rating saved
        </p>
        <form
          aria-label="Help improve the Help Center"
          data-kova-notice-id="survey_requested"
          className="mt-3 space-y-3 rounded-2xl border border-border bg-card p-4 text-sm sm:max-w-[23rem]"
          onSubmit={(event) => {
            event.preventDefault();
            const answer = comment.trim();
            if (answer) void rate("down", answer);
          }}
        >
          <p className="font-medium">Help improve the Help Center</p>
          <Label htmlFor={fieldId}>What could work better?</Label>
          <Textarea
            id={fieldId}
            value={comment}
            maxLength={2000}
            disabled={busy}
            onChange={(event) => setComment(event.target.value)}
          />
          {state === "survey-error" && (
            <p className="text-destructive" role="alert">
              Your feedback could not be saved. Try again.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || !comment.trim()}>
              Save feedback
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setState("saved");
                returnFocus();
              }}
            >
              Skip
            </Button>
          </div>
        </form>
      </>
    );
  }

  return (
    <aside
      aria-label="Rate this experience"
      data-kova-notice-id="rating_requested"
      className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm sm:max-w-[23rem]"
    >
      <p className="font-medium">Rate this experience</p>
      {state === "rating-error" && (
        <p role="alert" className="mt-1 text-destructive">
          Your rating could not be saved. Try again.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void rate("up")}
        >
          Helpful
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void rate("down")}
        >
          Needs work
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            rememberNoticeDismissal(safeBrowserStorage("localStorage"), {
              ...dismissal,
              accountId: ownerId,
            });
            setState("hidden");
            returnFocus();
          }}
        >
          Skip
        </Button>
      </div>
    </aside>
  );
}
