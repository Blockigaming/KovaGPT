import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { DEVELOPER_DOC_BY_SLUG } from "@/lib/developer-docs";
import { PublicPageView } from "@/components/public/PublicSite";
export const Route = createFileRoute("/developers/$docSlug")({
  loader: ({ params }) => {
    const doc = DEVELOPER_DOC_BY_SLUG.get(params.docSlug);
    if (!doc) throw notFound();
    return doc;
  },
  component: UnavailableDeveloperDoc,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
});

function UnavailableDeveloperDoc() {
  const doc = Route.useLoaderData();
  return (
    <PublicPageView eyebrow="Developer documentation" title={doc.title} summary={doc.description}>
      <section className="space-y-3 rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Prepare an integration</h2>
        <p>
          Create a verified account and scoped key in the console. Configure organization, project,
          and key budgets, then fund the account when purchases are available. Keep keys in your
          server’s secret manager. Paid execution is disabled until the operator enables it with
          verified pricing.
        </p>
        <Link to="/developers/console" className="underline">
          Open developer console
        </Link>
      </section>
      <section className="space-y-3 rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Version 1 request contract</h2>
        <p>
          Use HTTPS and Authorization: Bearer with your developer key. GET /api/v1/models lists
          current public model names for your key. POST /api/v1/quotes with operation and input
          obtains a signed two-minute quote. Submit the identical input to the corresponding
          endpoint with X-Kova-Quote and a stable, unique Idempotency-Key.
        </p>
        <ul className="list-disc pl-5">
          <li>
            /api/v1/responses: model, text input, optional instructions, required max_output_tokens,
            optional stream.
          </li>
          <li>/api/v1/images: model, prompt, size, quality, optional n (at most four).</li>
          <li>
            /api/v1/embeddings: model, text input or up to 32 text inputs, optional dimensions.
          </li>
        </ul>
        <p>
          A changed request, expired quote, increased charge, or changed pricing version needs a new
          quote. Public models map to reviewed provider deployments on the server.
        </p>
      </section>
      <section className="space-y-3 rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Billing and retries</h2>
        <p>
          All displayed credit amounts and spending limits use the account currency’s minor units.
          The accepted maximum is reserved before dispatch. Authoritative provider usage determines
          the final charge and releases unused credit. A timeout or disconnect can leave a hold
          pending reconciliation. Reusing a request key never starts the same provider operation
          again; check the console before creating a new request.
        </p>
        <p>
          Responses streams forward native provider events. A terminal usage event can settle a
          charge even if the client disconnects afterward. Requests do not enable provider-side
          response storage. No client field can supply prices, usage, provider URLs, or another
          account’s identity.
        </p>
      </section>
      <section className="space-y-3 rounded-xl border p-6">
        <h2 className="text-lg font-semibold">MCP and supported boundaries</h2>
        <p>
          /mcp supports stateless Streamable HTTP with a developer bearer key for clients that
          support explicit bearer credentials, or owner-approved OAuth access. Send Accept:
          application/json, text/event-stream and MCP-Protocol-Version: 2025-11-25. The quote, text,
          image, and embedding tools use the same billing and scope checks. Browser OAuth discovery
          is available only when the configured issuer and developer execution are enabled. Review
          the exact client, callback, developer project, permissions and spending limits before
          approving a connection. OAuth grants confer no consumer Project or Library access.
        </p>
        <p>
          Hosted tools, remote file inputs, multimodal Responses input, public file storage, and an
          official SDK are not part of this version. Internal application endpoints remain outside
          the versioned API contract.
        </p>
      </section>
    </PublicPageView>
  );
}
