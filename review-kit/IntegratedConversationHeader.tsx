/** Private review build only. The normal app never imports this module. */
import { useEffect, useState, type ComponentProps } from "react";
import { ConversationHeaderActions as ActualConversationHeader } from "../src/components/ConversationHeaderActions";
import { IntegratedBrowserDialog, SampleBrowserThumbnail } from "./IntegratedBrowserPreview";
import { transitionBrowserPreview } from "./browser-takeover-fixture.mjs";

const SAMPLE_CHAT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export function ConversationHeaderActions(props: ComponentProps<typeof ActualConversationHeader>) {
  const [session, setSession] = useState("active");
  const [sampleText, setSampleText] = useState("");
  useEffect(() => {
    setSession("active");
    setSampleText("");
  }, [props.conversation.id]);
  const sampleConversation =
    props.signedIn &&
    (props.userTier === "plus" || props.userTier === "pro") &&
    props.conversation.id === SAMPLE_CHAT_ID &&
    props.conversation.messages.some((message) =>
      message.activities?.some(
        (activity) =>
          activity.tool === "browser_interact" &&
          activity.label === "Sample browser event · no live session",
      ),
    );
  const act = (action: string) => {
    setSession((state) => transitionBrowserPreview(state, action));
    if (action === "release" || action === "end") setSampleText("");
  };
  return (
    <ActualConversationHeader
      {...props}
      browserPresentation={
        sampleConversation
          ? {
              thumbnail: <SampleBrowserThumbnail />,
              renderDialog: ({ onClose, onCloseAutoFocus }) => (
                <IntegratedBrowserDialog
                  session={session}
                  sampleText={sampleText}
                  onTextChange={setSampleText}
                  onAction={act}
                  onClose={() => {
                    setSampleText("");
                    onClose();
                  }}
                  onCloseAutoFocus={onCloseAutoFocus}
                />
              ),
            }
          : undefined
      }
    />
  );
}
