import { useState } from "react";
import { HELP_FAQS } from "@/lib/help-center-data";
import {
  HELP_ENVIRONMENTS,
  HELP_CONNECTIONS,
  HELP_PLANS,
  HELP_STAGES,
  contextualHelp,
  diagnosticCoverage,
} from "@/lib/help-diagnostics.mjs";
export function GuidedHelp() {
  const [issue, setIssue] = useState(HELP_FAQS[0].id),
    [environment, setEnvironment] = useState(HELP_ENVIRONMENTS[0].id),
    [connection, setConnection] = useState("online"),
    [plan, setPlan] = useState("free"),
    [stage, setStage] = useState("first");
  const faq = HELP_FAQS.find((item) => item.id === issue)!;
  return (
    <details className="kova-guided-help">
      <summary>
        <span>Find a fix for your setup</span>
        <small>{diagnosticCoverage(HELP_FAQS.length).toLocaleString()} guided combinations</small>
      </summary>
      <p>
        Choose your issue, browser, connection, plan, and when it began for specific next steps.
        These paths combine our help articles with setup checks; they are not separate reports of
        every possible problem.
      </p>
      <div className="kova-guided-help-selects">
        <label>
          Your issue
          <select aria-label="Help issue" value={issue} onChange={(e) => setIssue(e.target.value)}>
            {HELP_FAQS.map((faq) => (
              <option key={faq.id} value={faq.id}>
                {faq.question}
              </option>
            ))}
          </select>
        </label>
        <label>
          Browser & device
          <select
            aria-label="Help browser"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
          >
            {HELP_ENVIRONMENTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Connection
          <select
            aria-label="Help connection"
            value={connection}
            onChange={(e) => setConnection(e.target.value)}
          >
            {HELP_CONNECTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kova plan
          <select aria-label="Help plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
            {HELP_PLANS.map((tier) => (
              <option key={tier} value={tier}>
                {tier[0].toUpperCase() + tier.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          When it started
          <select aria-label="Help stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            {HELP_STAGES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ol aria-label="Troubleshooting steps">
        {contextualHelp(faq, { environment, connection, plan, stage }).map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </details>
  );
}
