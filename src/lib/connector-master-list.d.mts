export type MasterConnector = Readonly<{ id: string; label: string }>;
export const USER_REQUESTED_MASTER_CONNECTORS: readonly MasterConnector[];
export const MASTER_CONNECTORS: readonly MasterConnector[];
export const MASTER_CONNECTOR_IDS: readonly string[];
export function masterConnectorSearchText(id: string): string;
