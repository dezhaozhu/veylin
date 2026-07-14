/** Enterprise shell ports — Host contracts; adapters are swappable via env. */

export type MembershipRole = 'owner' | 'admin' | 'member';

export type IdentitySession = {
  userId: string;
  email?: string;
  displayName?: string;
};

export type IdentityPort = {
  readonly id: string;
  getSession(headers: HeadersLike): Promise<IdentitySession | null>;
  signUp?(input: { email: string; password: string; name?: string }): Promise<void>;
  signIn?(input: { email: string; password: string }): Promise<{ token?: string } | void>;
  signOut?(headers: HeadersLike): Promise<void>;
  /** When true, Host should show local login/register UI. */
  supportsLocalCredentials: boolean;
};

export type HeadersLike = Record<string, string | string[] | undefined> | Headers;

export type OrgMembership = {
  tenantId: string;
  role: MembershipRole;
};

export type OrgDirectoryPort = {
  readonly id: string;
  resolveTenant(userId: string, displayName?: string): Promise<OrgMembership>;
  listMembers?(tenantId: string): Promise<Array<{ userId: string; role: MembershipRole }>>;
  /** Filter MCP tool names by role; return null to allow all. */
  allowedToolsForRole?(role: MembershipRole, allToolIds: string[]): string[] | null;
};

export type BusinessSourceView = {
  enabled: boolean;
  mcpServerName: string;
  hasCredential: boolean;
  toolAllowlist: string[];
  url?: string;
  transport?: 'http' | 'sse';
};

export type BusinessSourcePatch = {
  enabled?: boolean;
  mcpServerName?: string;
  url?: string;
  transport?: 'http' | 'sse';
  /** Omit or empty to keep existing credential headers. */
  authorization?: string;
  toolAllowlist?: string[];
  clearCredential?: boolean;
};

export type BusinessSourcePort = {
  readonly id: string;
  getSource(tenantId: string): Promise<BusinessSourceView | null>;
  updateSource(tenantId: string, patch: BusinessSourcePatch): Promise<BusinessSourceView>;
  clearSource(tenantId: string): Promise<BusinessSourceView>;
  /**
   * Filter MCP toolsets for the agent. Returns a possibly reduced map.
   * When source disabled / unset, returns input unchanged (shell stays usable).
   */
  filterToolsets(
    tenantId: string,
    userId: string,
    mcpToolsets: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
};

export type AuditEvent = {
  tenantId: string;
  userId: string;
  action: string;
  threadId?: string;
  detail?: unknown;
};

export type AuditRow = {
  id: string;
  tenantId: string;
  userId?: string | null;
  threadId?: string | null;
  action: string;
  detail?: unknown;
  createdAt?: string;
};

export type AuditPort = {
  readonly id: string;
  record(event: AuditEvent): Promise<void>;
  list?(tenantId: string, opts?: { limit?: number }): Promise<AuditRow[]>;
};

export type EnterprisePorts = {
  identity: IdentityPort;
  org: OrgDirectoryPort;
  businessSource: BusinessSourcePort;
  audit: AuditPort;
};
