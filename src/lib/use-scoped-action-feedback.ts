import { useEffect, useRef, useState } from "react";

type ActionTicket = { scope: string; epoch: number; action: string; sequence: number };

/** UI feedback only. This never retries an operation or declares a failed write rolled back. */
export function useScopedActionFeedback(scope: string) {
  const context = useRef({
    scope,
    epoch: 0,
    sequence: 0,
    active: true,
    pending: new Map<string, number>(),
  });
  if (context.current.scope !== scope) {
    context.current = {
      scope,
      epoch: context.current.epoch + 1,
      sequence: 0,
      active: true,
      pending: new Map(),
    };
  }
  const [state, setState] = useState<{ scope: string; errors: Record<string, string> }>({
    scope,
    errors: {},
  });
  useEffect(() => {
    context.current.active = true;
    return () => {
      context.current.active = false;
      context.current.epoch += 1;
      context.current.pending.clear();
    };
  }, []);
  const scopeCurrent = (ticket: ActionTicket) => {
    const now = context.current;
    return now.active && now.scope === ticket.scope && now.epoch === ticket.epoch;
  };
  const current = (ticket: ActionTicket) =>
    scopeCurrent(ticket) && context.current.pending.get(ticket.action) === ticket.sequence;
  const clear = (action: string) => {
    if (!context.current.active || context.current.scope !== scope) return;
    const activeScope = context.current.scope;
    setState((previous) => {
      const errors = previous.scope === activeScope ? { ...previous.errors } : {};
      delete errors[action];
      return { scope: activeScope, errors };
    });
  };
  const begin = (action: string): ActionTicket | null => {
    const now = context.current;
    if (!now.active || now.scope !== scope || now.pending.has(action)) return null;
    const sequence = ++now.sequence;
    now.pending.set(action, sequence);
    clear(action);
    return { scope, epoch: now.epoch, action, sequence };
  };
  const finish = (ticket: ActionTicket, error?: string) => {
    if (!current(ticket)) return false;
    context.current.pending.delete(ticket.action);
    setState((previous) => {
      const errors = previous.scope === ticket.scope ? { ...previous.errors } : {};
      if (error) errors[ticket.action] = error;
      else delete errors[ticket.action];
      return { scope: ticket.scope, errors };
    });
    return true;
  };
  return {
    errors: state.scope === scope ? state.errors : {},
    begin,
    current,
    scopeCurrent,
    finish,
    clear,
  };
}
