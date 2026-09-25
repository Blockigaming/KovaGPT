export function readAccountExportIdentity(
  admin: {
    rpc(
      name: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error?: unknown }>;
    auth: {
      admin: { getUserById(id: string): PromiseLike<{ data: { user: unknown }; error?: unknown }> };
    };
  },
  userId: string,
): Promise<Record<string, unknown>>;

export function projectAccountExportIdentity(
  admin: {
    rpc(
      name: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error?: unknown }>;
  },
  userId: string,
  user: unknown,
): Promise<Record<string, unknown>>;
