/** Enterprise shell ports — Host contracts; adapters are swappable via env. */

export type MembershipRole = 'owner' | 'admin' | 'member';

/**
 * 身份有**两个角色**,分开命名不复用同一个字段 —— 复用是这里所有事故的根源:
 * 一个字段既表示"这份本地数据归谁",又表示"拿谁的身份去授权",于是任何一侧
 * 的改动都会牵动另一侧(2026-08-25 差点因此让存量会话全部失去归属)。
 */
export type IdentitySession = {
  /**
   * **本地数据归谁**。桌面端 = installId(与数据目录同生共死)。
   * 登录、登出、换账号都**不变** —— 否则登出就等于丢数据。
   */
  resourceOwnerId: string;
  /**
   * **平台账号**,登录才有。用于授权访问远端(Compass 场景等)。
   * **绝不用作本地数据归属** —— 那会让登出把数据带走。
   */
  accountId?: string;
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
