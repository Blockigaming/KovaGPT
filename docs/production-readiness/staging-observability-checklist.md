# Staging observability checklist

For each smoke phase correlate deployment revision, request/correlation ID, route, safe error category, provider category, Stripe event ID, connector connection ID, or migration attempt ID as applicable. Confirm dashboards distinguish 4xx/5xx, timeout, rate limit, auth denial, dependency degradation, and replica restart.

Search redacted logs for forbidden material before traffic: `Authorization`, bearer/access/refresh tokens, cookies, database URLs, service-role/provider/Stripe secrets, payment details, full webhook bodies, raw prompts, and uploaded file contents. Treat any match as a security stop; rotate exposed credentials, remove the log sink entry under the approved retention process, patch redaction, and retest. Do not paste raw logs into tickets.
