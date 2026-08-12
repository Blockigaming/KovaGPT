# Production incident observability guide

Search by correlation/request ID, route, safe error code, provider category, deployment revision, and timestamp. Billing investigations additionally use Stripe event ID; connector investigations use provider and connection ID; never query by raw token, authorization header, secret, prompt, attachment contents, webhook body, or payment details.

Required safe fields: timestamp, revision, request ID, route/operation, status, retryability, owner hash where approved, and redacted subsystem code. Separate public error text from internal diagnostic category. If sensitive content appears, stop export, restrict the sink, rotate the affected credential, preserve audit access, and follow incident response.
