import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalArticle } from "@/components/LegalArticle";
import { LegalDoc, LegalDocEndnote, LegalDocHero } from "@/components/public/LegalDoc";
import type { LegalDocSection } from "@/components/public/LegalDoc";
import { PublicShell } from "@/components/public/PublicShell";

const DESCRIPTION =
  "How KovaGPT handles account data, prompts, files, provider processing, local history, billing, and deletion requests.";

const SECTIONS: readonly LegalDocSection[] = [
  { id: "data", label: "Information KovaGPT processes" },
  { id: "usage", label: "How information is used" },
  { id: "providers", label: "AI, search, and image providers" },
  { id: "voice", label: "Voice and drawings" },
  { id: "storage", label: "Cookies and local storage" },
  { id: "connected-apps", label: "Connected apps" },
  { id: "local-history", label: "Local history, temporary chats, and sharing" },
  { id: "human-access", label: "Human access" },
  { id: "payments", label: "Payments" },
  { id: "security", label: "Security" },
  { id: "retention", label: "Retention, export, and deletion" },
  { id: "sale", label: "Sale and advertising" },
  { id: "children", label: "Children and teens" },
  { id: "changes", label: "Changes" },
  { id: "contact", label: "Contact" },
];

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "KovaGPT Privacy" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Privacy Policy - KovaGPT" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://kovagpt.com/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <PublicShell>
      <LegalArticle>
        <LegalDocHero
          eyebrow="KovaGPT legal"
          title="Privacy Policy"
          meta="Last updated: November 5, 2026"
          description={DESCRIPTION}
        />
        <LegalDoc sections={SECTIONS}>
          <section id="data" data-legal-section className="legal-section">
            <h2>Information KovaGPT Processes</h2>
            <p>
              This policy describes how KovaGPT handles information when you use the service.
              Different features store different data: some conversation history is kept on your
              device, while account-backed projects, library items, billing records, and
              connected-app data can be processed or stored by server-side services.
            </p>
            <ul>
              <li>
                <strong>Account information:</strong> identifiers and profile claims supplied by the
                configured sign-in provider, such as user ID and email.
              </li>
              <li>
                <strong>Content you submit:</strong> prompts, messages, files, images, project
                content, connected-app requests, feedback, and support messages.
              </li>
              <li>
                <strong>Saved content:</strong> account-backed items you choose to keep in projects,
                Library, shared workspaces, or other storage-enabled features.
              </li>
              <li>
                <strong>Billing information:</strong> subscription status and payment-provider
                customer references. KovaGPT does not directly store your full payment-card number.
              </li>
              <li>
                <strong>Technical and security data:</strong> request metadata, usage counters,
                browser or device information, and error or abuse-prevention events needed to
                operate and protect the service.
              </li>
            </ul>
          </section>

          <section id="usage" data-legal-section className="legal-section">
            <h2>How Information Is Used</h2>
            <p>
              KovaGPT uses information to authenticate users, deliver requested features, enforce
              plan and safety limits, save content when you choose an account-backed feature,
              process billing, investigate failures or abuse, respond to support requests, and
              improve service reliability.
            </p>
          </section>

          <section id="providers" data-legal-section className="legal-section">
            <h2>AI, Search, and Image Providers</h2>
            <p>
              When you ask for an AI response, web search or generated image, KovaGPT may send the
              prompt and relevant conversation or attachment content to configured third-party
              providers. Search queries and retrieved pages can also be processed by the search
              provider. These features can fail or be unavailable when a provider is not configured
              or is experiencing an outage.
            </p>
            <p>
              The KovaGPT application does not include a Kova-owned model-training workflow.
              Third-party providers process data under the provider terms, Kova configuration, and
              agreements that apply to that service at the time. Those terms and retention practices
              can differ by provider and feature, so do not submit secrets or regulated information
              unless you have independently confirmed the workflow is appropriate for it.
            </p>
          </section>

          <section id="voice" data-legal-section className="legal-section">
            <h2>Voice and drawings</h2>
            <p>
              When you start dictation, KovaGPT sends the recording you choose to submit to
              ElevenLabs for transcription. Spoken assistant replies send the selected saved reply
              text to ElevenLabs to produce audio. KovaGPT does not start microphone recording
              merely because you open the website or Settings. Provider terms and retention rules
              apply; KovaGPT does not promise that the provider retains no data.
            </p>
            <p>
              Drawings stay in the local editor until you attach them. Attached drawings use the
              same image, chat and Library controls as other uploaded images. Saving or sending a
              drawing can process or retain it as described for other attachments.
            </p>
          </section>
          <section id="storage" data-legal-section className="legal-section">
            <h2>Cookies and browser storage</h2>
            <p>
              Account sessions, security controls, conversation drafts, local history and
              preferences can use cookies, local storage and IndexedDB. Clearing browser storage can
              sign you out or remove device-local drafts, but it does not delete server-side
              account, billing or provider records. Use the account controls or contact Support for
              those requests.
            </p>
            <p>
              If optional tracking is introduced, the applicable notices and consent controls must
              be provided before that tracking runs. Installing the desktop or web app does not
              change the privacy choices for your account.
            </p>
          </section>
          <section id="connected-apps" data-legal-section className="legal-section">
            <h2>Connected Apps</h2>
            <p>
              If you connect an external account, KovaGPT can receive account identifiers,
              authorization tokens, and the data needed for actions you request. Available scopes
              and actions depend on the provider and current configuration. Disconnect the app in
              KovaGPT when that control is available and revoke access from the provider's own
              security page when you want to ensure provider-side authorization is removed.
            </p>
          </section>

          <section id="local-history" data-legal-section className="legal-section">
            <h2>Local History, Temporary Chats, Projects, and Sharing</h2>
            <p>
              Standard conversation history can be stored in your browser. Device-local history does
              not automatically become a complete cloud archive or follow you to every device.
              Account-backed project chats, files, Library items, and other saved features can be
              stored server-side. Temporary Chat is intended not to add the conversation to normal
              history or memory, but its content still has to be processed to answer the request and
              may appear in security or provider systems subject to their retention practices.
            </p>
            <p>
              Content is not public merely because it is saved. If you create a share link, invite
              project members, or send content through a connected app, the recipients and provider
              can access the information you chose to share. Public view-only links expose the
              selected text snapshot to anyone with that link until it expires or is revoked; future
              messages, other branches and private tool details are excluded.
            </p>
          </section>

          <section id="human-access" data-legal-section className="legal-section">
            <h2>Human Access</h2>
            <p>
              Authorized operators may access account or content data when reasonably necessary to
              answer a support request, investigate abuse or a security incident, maintain the
              service, enforce terms, or comply with law. KovaGPT does not promise that staff can
              never access a conversation.
            </p>
          </section>

          <section id="payments" data-legal-section className="legal-section">
            <h2>Payments</h2>
            <p>
              Stripe processes customer checkout and billing. Stripe's terms and privacy practices
              apply to the information collected in its checkout and customer portal. KovaGPT
              receives the customer and subscription information needed to recognize paid access.
            </p>
          </section>

          <section id="security" data-legal-section className="legal-section">
            <h2>Security</h2>
            <p>
              KovaGPT uses HTTPS for data in transit and server-side authorization checks for
              protected account operations. No online service can guarantee absolute security.
              Storage protection, retention, and incident controls also depend on the hosting,
              identity, billing, AI, search, and connected-app providers involved in a workflow.
            </p>
          </section>

          <section id="retention" data-legal-section className="legal-section">
            <h2>Retention, Export, and Deletion</h2>
            <p>
              Use the in-product delete controls for chats, projects, files, connections, or the
              account when those controls are available. The Settings data export covers the device
              data identified by that control; it is not a promise of an emailed or complete
              provider-side archive. For an account-data request that is not covered in the product,
              email <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> from the address
              associated with the account.
            </p>
            <p>
              Kova may require identity or account verification before processing a deletion
              request. Data may remain in backups, security records, billing or tax records,
              provider systems, or records Kova must keep to comply with law, resolve disputes, or
              prevent abuse. Retention periods depend on the record, provider, and applicable
              operational or legal requirement. Removing a KovaGPT connection does not delete data
              already sent to the external provider or another recipient.
            </p>
          </section>

          <section id="sale" data-legal-section className="legal-section">
            <h2>Sale and Advertising</h2>
            <p>
              Kova does not sell the contents of your prompts, chats, projects, or files for
              third-party advertising. External services used to operate the product receive data as
              described in this policy and under their applicable terms.
            </p>
            <p>
              If advertising is enabled for Free accounts, Google may show a separate advertisement
              below a completed response. Google may process your IP address, device information,
              cookies, and content on the page to select and measure ads. Ad selection does not
              influence Kova's answers. Advertising choices are available through Privacy and cookie
              settings beside the ad area. Temporary chats and paid plans do not display these ads.
            </p>
          </section>

          <section id="children" data-legal-section className="legal-section">
            <h2>Children and Teens</h2>
            <p>
              KovaGPT is for people aged 13 or older who meet any higher minimum age in their
              location. People under 18 need permission from a parent or legal guardian. If you
              believe a child below the applicable minimum has provided personal information,
              contact support@kovagpt.com so the account can be investigated and the appropriate
              action taken. Do not submit a child's sensitive information through AI or
              connected-app features without an appropriate basis and consent.
            </p>
          </section>

          <section id="changes" data-legal-section className="legal-section">
            <h2>Changes</h2>
            <p>
              Kova may update this policy as the service and its providers change. The updated date
              at the top identifies the current version. Material changes may also be communicated
              in the product or by email when appropriate.
            </p>
          </section>

          <section id="contact" data-legal-section className="legal-section">
            <h2>Contact</h2>
            <p>
              Privacy questions or requests:{" "}
              <a href="mailto:support@kovagpt.com">support@kovagpt.com</a>.
            </p>
          </section>
        </LegalDoc>

        <LegalDocEndnote>
          <Link to="/">Back to KovaGPT</Link>
          <Link to="/terms">Terms of Service</Link>
        </LegalDocEndnote>
      </LegalArticle>
    </PublicShell>
  );
}
