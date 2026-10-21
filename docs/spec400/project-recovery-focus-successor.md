# Project recovery focus successor

The f35f129 rendered pass reproduced disappearing-control focus after explicit Tasks/Memory Retry, task status changes and Memory Add. Task deletion also lacked an in-dialog persistent failure, selected title and close destination.

The successor moves focus synchronously on an intentional retry/action to a stable Project tasks region or Memory summary before the control disables or disappears. These elements persist across loading and settled outcomes. Completion performs no later autofocus, so later keyboard/pointer navigation is not overridden. Initial automatic loads do not focus content. Captured account/project lifetimes continue to gate requests.

Task deletion names the selected task and passes its failure into the open confirmation as an alert. Cancel returns its still-connected invoker; successful removal falls back to the stable task region. Account/project generation and URL changes suppress stale return focus. The generic local confirmation supports the optional error/close callback without changing other callers' operation contracts.

86 focused Tasks/Memory/member tests pass after these changes, including direct production-component handlers for persistent retry focus, successful/failed status regrouping, named task deletion, cancellation/error/success focus, and later user focus during Memory Add. Rendered successor verification remains pending. No backend, task execution or live mutation was performed.
