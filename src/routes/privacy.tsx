import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalArticle } from "@/components/LegalArticle";
import { PublicShell } from "@/components/public/PublicShell";

const DESCRIPTION =
  "How KovaGPT handles account data, prompts, files, provider processing, local history, billing, and deletion requests.";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "KovaGPT Privacy" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Privacy Policy - KovaGPT" },
      { property: "og:description", content: DESCRIPTION },
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
        <h1>Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">Last updated: August 1, 2026</p>
        <p>
          This policy describes how KovaGPT handles information when you use the service. Different
          features store different data: some conversation history is kept on your device, while
          account-backed projects, library items, billing records, and connected-app data can be
          processed or stored by server-side services.
        </p>

        <h2>Information KovaGPT Processes</h2>
        <ul>
          <li>
            <strong>Account information:</strong> identifiers and profile claims supplied by the
            configured sign-in provider, such as user ID and email.
          </li>
          <li>
            <strong>Content you submit:</strong> prompts, messages, files, images, project content,
            connected-app requests, feedback, and support messages.
          </li>
          <li>
            <strong>Saved content:</strong> account-backed items you choose to keep in projects,
            Library, shared workspaces, or other storage-enabled features.
          </li>
          <li>
            <strong>Billing information:</strong> subscription status and payment-provider customer
            references. KovaGPT does not directly store your full payment-card number.
          </li>
          <li>
            <strong>Technical and security data:</strong> request metadata, usage counters, browser
            or device information, and error or abuse-prevention events needed to operate and
            protect the service.
          </li>
        </ul>

        <h2>How Information Is Used</h2>
        <p>
          KovaGPT uses information to authenticate users, deliver requested features, enforce plan
          and safety limits, save content when you choose an account-backed feature, process
          billing, investigate failures or abuse, respond to support requests, and improve service
          reliability.
        </p>

        <h2>AI, Search, and Image Providers</h2>
        <p>
          When you ask for an AI response, web search, Deep Research report, or generated image,
          KovaGPT may send the prompt and relevant conversation or attachment content to configured
          third-party providers. Search queries and retrieved pages can also be processed by the
          search provider. These features can fail or be unavailable when a provider is not
          configured or is experiencing an outage.
        </p>
        <p>
          The KovaGPT application does not include a Kova-owned model-training workflow. Third-party
          providers process data under the provider terms, Kova configuration, and agreements that
          apply to that service at the time. Those terms and retention practices can differ by
          provider and feature, so do not submit secrets or regulated information unless you have
          independently confirmed the workflow is appropriate for it.
        </p>

        <h2>Connected Apps</h2>
        <p>
          If you connect an external account, KovaGPT can receive account identifiers, authorization
          tokens, and the data needed for actions you request. Available scopes and actions depend
          on the provider and current configuration. Disconnect the app in KovaGPT when that control
          is available and revoke access from the provider's own security page when you want to
          ensure provider-side authorization is removed.
        </p>

        <h2>Local History, Temporary Chats, Projects, and Sharing</h2>
        <p>
          Standard conversation history can be stored in your browser. Device-local history does not
          automatically become a complete cloud archive or follow you to every device.
          Account-backed project chats, files, Library items, and other saved features can be stored
          server-side. Temporary Chat is intended not to add the conversation to normal history or
          memory, but its content still has to be processed to answer the request and may appear in
          security or provider systems subject to their retention practices.
        </p>
        <p>
          Content is not public merely because it is saved. If you create a share link, invite
          project members, or send content through a connected app, the recipients and provider can
          access the information you chose to share.
        </p>

        <h2>Human Access</h2>
        <p>
          Authorized operators may access account or content data when reasonably necessary to
          answer a support request, investigate abuse or a security incident, maintain the service,
          enforce terms, or comply with law. KovaGPT does not promise that staff can never access a
          conversation.
        </p>

        <h2>Payments</h2>
        <p>
          Stripe processes customer checkout and billing. Stripe's terms and privacy practices apply
          to the information collected in its checkout and customer portal. KovaGPT receives the
          customer and subscription information needed to recognize paid access.
        </p>

        <h2>Security</h2>
        <p>
          KovaGPT uses HTTPS for data in transit and server-side authorization checks for protected
          account operations. No online service can guarantee absolute security. Storage protection,
          retention, and incident controls also depend on the hosting, identity, billing, AI,
          search, and connected-app providers involved in a workflow.
        </p>

        <h2>Retention, Export, and Deletion</h2>
        <p>
          Use the in-product delete controls for chats, projects, files, connections, or the account
          when those controls are available. The Settings data export covers the device data
          identified by that control; it is not a promise of an emailed or complete provider-side
          archive. For an account-data request that is not covered in the product, email{" "}
          <a href="mailto:support@kovagpt.com">support@kovagpt.com</a> from the address associated
          with the account.
        </p>
        <p>
          Kova may require identity or account verification before processing a deletion request.
          Data may remain in backups, security records, billing or tax records, provider systems, or
          records Kova must keep to comply with law, resolve disputes, or prevent abuse. Retention
          periods depend on the record, provider, and applicable operational or legal requirement.
          Removing a KovaGPT connection does not delete data already sent to the external provider
          or another recipient.
        </p>

        <h2>Sale and Advertising</h2>
        <p>
          Kova does not sell the contents of your prompts, chats, projects, or files for third-party
          advertising. External services used to operate the product receive data as described in
          this policy and under their applicable terms.
        </p>

        <h2>Children and Teens</h2>
        <p>
          Use KovaGPT only if you meet the age requirements that apply in your location. A parent or
          guardian should supervise younger users where required. Do not submit a child's sensitive
          information through AI or connected-app features without an appropriate basis and consent.
        </p>

        <h2>Changes</h2>
        <p>
          Kova may update this policy as the service and its providers change. The updated date at
          the top identifies the current version. Material changes may also be communicated in the
          product or by email when appropriate.
        </p>

        <h2>Contact</h2>
        <p>
          Privacy questions or requests:{" "}
          <a href="mailto:support@kovagpt.com">support@kovagpt.com</a>.
        </p>

        <p className="mt-12">
          <Link to="/">← Back to KovaGPT</Link> · <Link to="/terms">Terms of Service</Link>
        </p>
      </LegalArticle>
    </PublicShell>
  );
}
