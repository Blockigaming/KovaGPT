/** A closed/replaced inspection cannot publish a late response from any account. */
export function createMemorySourceInspection(read) {
  let generation = 0;
  return {
    invalidate() {
      generation += 1;
    },
    async load(input) {
      const current = ++generation;
      try {
        const entries = await read(input);
        return current === generation ? { entries, error: null } : null;
      } catch {
        return current === generation
          ? { entries: [], error: "Memory sources could not be loaded. Try again." }
          : null;
      }
    },
  };
}
