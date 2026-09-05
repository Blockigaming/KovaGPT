// Vite replaces this value in both browser and server artifacts. Reading a
// runtime VITE_* variable cannot repair a browser built without its public key.
export const COMPILED_PAYMENTS_CLIENT_TOKEN =
  (import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined) || "";
