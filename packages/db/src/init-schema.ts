import type { Surreal } from 'surrealdb';

const SCHEMA_STATEMENTS: string[] = [
  'DEFINE NAMESPACE IF NOT EXISTS ia',
  'USE NS ia; DEFINE DATABASE IF NOT EXISTS main',
  'USE NS ia DB main',

  `DEFINE TABLE IF NOT EXISTS tenant SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON tenant TYPE string`,
  `DEFINE FIELD IF NOT EXISTS name ON tenant TYPE string`,
  `DEFINE FIELD IF NOT EXISTS created_at ON tenant TYPE datetime DEFAULT time::now()`,
  `DEFINE INDEX IF NOT EXISTS tenant_id_idx ON tenant FIELDS id UNIQUE`,

  `DEFINE TABLE IF NOT EXISTS membership SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON membership TYPE string`,
  `DEFINE FIELD IF NOT EXISTS user_id ON membership TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON membership TYPE string`,
  `DEFINE FIELD IF NOT EXISTS role ON membership TYPE string DEFAULT 'member'`,
  `DEFINE FIELD IF NOT EXISTS created_at ON membership TYPE datetime DEFAULT time::now()`,
  `DEFINE INDEX IF NOT EXISTS membership_user_idx ON membership FIELDS user_id`,
  `DEFINE INDEX IF NOT EXISTS membership_tenant_idx ON membership FIELDS tenant_id`,

  `DEFINE TABLE IF NOT EXISTS agent SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON agent TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON agent TYPE string`,
  `DEFINE FIELD IF NOT EXISTS name ON agent TYPE string`,
  `DEFINE FIELD IF NOT EXISTS definition ON agent FLEXIBLE TYPE object`,
  `DEFINE FIELD IF NOT EXISTS created_at ON agent TYPE datetime DEFAULT time::now()`,

  `DEFINE TABLE IF NOT EXISTS audit_log SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON audit_log TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON audit_log TYPE string`,
  `DEFINE FIELD IF NOT EXISTS user_id ON audit_log TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS thread_id ON audit_log TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS action ON audit_log TYPE string`,
  `DEFINE FIELD IF NOT EXISTS detail ON audit_log FLEXIBLE TYPE option<object>`,
  `DEFINE FIELD IF NOT EXISTS created_at ON audit_log TYPE datetime DEFAULT time::now()`,

  `DEFINE TABLE IF NOT EXISTS task SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON task TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON task TYPE string`,
  `DEFINE FIELD IF NOT EXISTS parent_thread_id ON task TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS agent_id ON task TYPE string`,
  `DEFINE FIELD IF NOT EXISTS prompt ON task TYPE string`,
  `DEFINE FIELD IF NOT EXISTS status ON task TYPE string DEFAULT 'queued'`,
  `DEFINE FIELD IF NOT EXISTS label ON task TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS result ON task TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS job_id ON task TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS created_at ON task TYPE datetime DEFAULT time::now()`,
  `DEFINE FIELD IF NOT EXISTS updated_at ON task TYPE datetime DEFAULT time::now()`,

  `DEFINE TABLE IF NOT EXISTS checkpoint SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON checkpoint TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON checkpoint TYPE string`,
  `DEFINE FIELD IF NOT EXISTS thread_id ON checkpoint TYPE string`,
  `DEFINE FIELD IF NOT EXISTS label ON checkpoint TYPE string`,
  `DEFINE FIELD IF NOT EXISTS snapshot ON checkpoint FLEXIBLE TYPE object`,
  `DEFINE FIELD IF NOT EXISTS created_at ON checkpoint TYPE datetime DEFAULT time::now()`,

  `DEFINE TABLE IF NOT EXISTS thread_state SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS thread_id ON thread_state TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON thread_state TYPE string`,
  `DEFINE FIELD IF NOT EXISTS resource_id ON thread_state TYPE string`,
  `DEFINE FIELD IF NOT EXISTS plan_mode ON thread_state TYPE bool DEFAULT false`,
  `DEFINE FIELD IF NOT EXISTS todos ON thread_state FLEXIBLE TYPE array DEFAULT []`,
  `DEFINE FIELD IF NOT EXISTS activated_skills ON thread_state FLEXIBLE TYPE object DEFAULT {}`,
  `DEFINE FIELD IF NOT EXISTS working_memory ON thread_state TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS title ON thread_state TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS updated_at ON thread_state TYPE datetime DEFAULT time::now()`,
  `DEFINE INDEX IF NOT EXISTS thread_state_pk ON thread_state FIELDS thread_id UNIQUE`,

  `DEFINE TABLE IF NOT EXISTS tenant_settings SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON tenant_settings TYPE string`,
  `DEFINE FIELD IF NOT EXISTS disabled_skills ON tenant_settings FLEXIBLE TYPE array DEFAULT []`,
  `DEFINE FIELD IF NOT EXISTS disabled_mcp_servers ON tenant_settings FLEXIBLE TYPE array DEFAULT []`,
  `DEFINE FIELD IF NOT EXISTS model_settings ON tenant_settings FLEXIBLE TYPE option<object>`,
  `DEFINE FIELD IF NOT EXISTS updated_at ON tenant_settings TYPE datetime DEFAULT time::now()`,
  `DEFINE INDEX IF NOT EXISTS tenant_settings_pk ON tenant_settings FIELDS tenant_id UNIQUE`,

  `DEFINE TABLE IF NOT EXISTS custom_skill SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON custom_skill TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON custom_skill TYPE string`,
  `DEFINE FIELD IF NOT EXISTS name ON custom_skill TYPE string`,
  `DEFINE FIELD IF NOT EXISTS description ON custom_skill TYPE string DEFAULT ''`,
  `DEFINE FIELD IF NOT EXISTS content ON custom_skill TYPE string`,
  `DEFINE FIELD IF NOT EXISTS enabled ON custom_skill TYPE bool DEFAULT true`,
  `DEFINE FIELD IF NOT EXISTS created_at ON custom_skill TYPE datetime DEFAULT time::now()`,

  `DEFINE TABLE IF NOT EXISTS rule SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON rule TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON rule TYPE string`,
  `DEFINE FIELD IF NOT EXISTS user_id ON rule TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS agent_id ON rule TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS name ON rule TYPE string`,
  `DEFINE FIELD IF NOT EXISTS content ON rule TYPE string`,
  `DEFINE FIELD IF NOT EXISTS trigger ON rule TYPE string DEFAULT 'always'`,
  `DEFINE FIELD IF NOT EXISTS keywords ON rule FLEXIBLE TYPE array DEFAULT []`,
  `DEFINE FIELD IF NOT EXISTS enabled ON rule TYPE bool DEFAULT true`,
  `DEFINE FIELD IF NOT EXISTS created_at ON rule TYPE datetime DEFAULT time::now()`,

  `DEFINE TABLE IF NOT EXISTS mcp_server SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON mcp_server TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON mcp_server TYPE string`,
  `DEFINE FIELD IF NOT EXISTS name ON mcp_server TYPE string`,
  `DEFINE FIELD IF NOT EXISTS transport ON mcp_server TYPE string`,
  `DEFINE FIELD IF NOT EXISTS url ON mcp_server TYPE string`,
  `DEFINE FIELD IF NOT EXISTS headers ON mcp_server FLEXIBLE TYPE object DEFAULT {}`,
  `DEFINE FIELD IF NOT EXISTS enabled ON mcp_server TYPE bool DEFAULT true`,
  `DEFINE FIELD IF NOT EXISTS created_at ON mcp_server TYPE datetime DEFAULT time::now()`,

  `DEFINE TABLE IF NOT EXISTS automation SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON automation TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON automation TYPE string`,
  `DEFINE FIELD IF NOT EXISTS user_id ON automation TYPE string`,
  `DEFINE FIELD IF NOT EXISTS name ON automation TYPE string`,
  `DEFINE FIELD IF NOT EXISTS kind ON automation TYPE string`,
  `DEFINE FIELD IF NOT EXISTS agent_id ON automation TYPE string`,
  `DEFINE FIELD IF NOT EXISTS prompt ON automation TYPE string`,
  `DEFINE FIELD IF NOT EXISTS enabled ON automation TYPE bool DEFAULT true`,
  `DEFINE FIELD IF NOT EXISTS cron ON automation TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS timezone ON automation TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS source_type ON automation TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS event_on ON automation TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS event_filter ON automation TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS created_at ON automation TYPE datetime DEFAULT time::now()`,
  `DEFINE FIELD IF NOT EXISTS last_run_at ON automation TYPE option<datetime>`,

  `DEFINE TABLE IF NOT EXISTS automation_run SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON automation_run TYPE string`,
  `DEFINE FIELD IF NOT EXISTS automation_id ON automation_run TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON automation_run TYPE string`,
  `DEFINE FIELD IF NOT EXISTS thread_id ON automation_run TYPE string`,
  `DEFINE FIELD IF NOT EXISTS status ON automation_run TYPE string DEFAULT 'queued'`,
  `DEFINE FIELD IF NOT EXISTS result ON automation_run TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS event_context ON automation_run FLEXIBLE TYPE object DEFAULT {}`,
  `DEFINE FIELD IF NOT EXISTS started_at ON automation_run TYPE datetime DEFAULT time::now()`,
  `DEFINE FIELD IF NOT EXISTS finished_at ON automation_run TYPE option<datetime>`,

  `DEFINE TABLE IF NOT EXISTS webhook_endpoint SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON webhook_endpoint TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON webhook_endpoint TYPE string`,
  `DEFINE FIELD IF NOT EXISTS name ON webhook_endpoint TYPE string`,
  `DEFINE FIELD IF NOT EXISTS source ON webhook_endpoint TYPE string`,
  `DEFINE FIELD IF NOT EXISTS secret ON webhook_endpoint TYPE string`,
  `DEFINE FIELD IF NOT EXISTS event_key_expr ON webhook_endpoint TYPE string DEFAULT 'type'`,
  `DEFINE FIELD IF NOT EXISTS signature_header ON webhook_endpoint TYPE string DEFAULT 'X-Signature-256'`,
  `DEFINE FIELD IF NOT EXISTS enabled ON webhook_endpoint TYPE bool DEFAULT true`,
  `DEFINE FIELD IF NOT EXISTS created_at ON webhook_endpoint TYPE datetime DEFAULT time::now()`,
  `DEFINE INDEX IF NOT EXISTS webhook_tenant_source_idx ON webhook_endpoint FIELDS tenant_id, source UNIQUE`,

  `DEFINE TABLE IF NOT EXISTS schedule_sheet SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON schedule_sheet TYPE string`,
  `DEFINE FIELD IF NOT EXISTS name ON schedule_sheet TYPE string`,
  `DEFINE FIELD IF NOT EXISTS builtin ON schedule_sheet TYPE bool DEFAULT false`,

  `DEFINE TABLE IF NOT EXISTS schedule_column SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS sheet_id ON schedule_column TYPE string`,
  `DEFINE FIELD IF NOT EXISTS key ON schedule_column TYPE string`,
  `DEFINE FIELD IF NOT EXISTS name ON schedule_column TYPE string`,
  `DEFINE FIELD IF NOT EXISTS width ON schedule_column TYPE int`,
  `DEFINE FIELD IF NOT EXISTS type ON schedule_column TYPE string`,
  `DEFINE FIELD IF NOT EXISTS frozen ON schedule_column TYPE option<bool>`,
  `DEFINE FIELD IF NOT EXISTS deletable ON schedule_column TYPE bool DEFAULT true`,
  `DEFINE FIELD IF NOT EXISTS position ON schedule_column TYPE int DEFAULT 0`,

  `DEFINE TABLE IF NOT EXISTS schedule_row SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS sheet_id ON schedule_row TYPE string`,
  `DEFINE FIELD IF NOT EXISTS row_key ON schedule_row TYPE string`,
  `DEFINE FIELD IF NOT EXISTS data ON schedule_row FLEXIBLE TYPE object`,

  `DEFINE TABLE IF NOT EXISTS document SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON document TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON document TYPE string`,
  `DEFINE FIELD IF NOT EXISTS filename ON document TYPE string`,
  `DEFINE FIELD IF NOT EXISTS mime_type ON document TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS size_bytes ON document TYPE option<int>`,
  `DEFINE FIELD IF NOT EXISTS status ON document TYPE string DEFAULT 'pending'`,
  `DEFINE FIELD IF NOT EXISTS error ON document TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS created_at ON document TYPE datetime DEFAULT time::now()`,

  `DEFINE TABLE IF NOT EXISTS chunk SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON chunk TYPE string`,
  `DEFINE FIELD IF NOT EXISTS document_id ON chunk TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON chunk TYPE string`,
  `DEFINE FIELD IF NOT EXISTS text ON chunk TYPE string`,
  `DEFINE FIELD IF NOT EXISTS source ON chunk TYPE string`,
  `DEFINE FIELD IF NOT EXISTS offset ON chunk TYPE int DEFAULT 0`,
  `DEFINE FIELD IF NOT EXISTS embedding ON chunk TYPE option<array<float>>`,

  `DEFINE TABLE IF NOT EXISTS entity SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON entity TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON entity TYPE string`,
  `DEFINE FIELD IF NOT EXISTS name ON entity TYPE string`,
  `DEFINE FIELD IF NOT EXISTS type ON entity TYPE string DEFAULT 'concept'`,
  `DEFINE FIELD IF NOT EXISTS document_id ON entity TYPE option<string>`,

  `DEFINE TABLE IF NOT EXISTS relates SCHEMAFULL TYPE RELATION`,
  `DEFINE FIELD IF NOT EXISTS id ON relates TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON relates TYPE string`,
  `DEFINE FIELD IF NOT EXISTS in ON relates TYPE record<entity>`,
  `DEFINE FIELD IF NOT EXISTS out ON relates TYPE record<entity>`,
  `DEFINE FIELD IF NOT EXISTS relation ON relates TYPE string`,
  `DEFINE FIELD IF NOT EXISTS document_id ON relates TYPE option<string>`,
  `DEFINE TABLE IF NOT EXISTS workflow SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON workflow TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON workflow TYPE string`,
  `DEFINE FIELD IF NOT EXISTS user_id ON workflow TYPE string`,
  `DEFINE FIELD IF NOT EXISTS name ON workflow TYPE string`,
  `DEFINE FIELD IF NOT EXISTS kind ON workflow TYPE string DEFAULT 'manual'`,
  `DEFINE FIELD IF NOT EXISTS enabled ON workflow TYPE bool DEFAULT true`,
  `DEFINE FIELD IF NOT EXISTS cron ON workflow TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS timezone ON workflow TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS source_type ON workflow TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS event_on ON workflow TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS event_filter ON workflow TYPE option<string>`,
  `DEFINE FIELD IF NOT EXISTS definition ON workflow FLEXIBLE TYPE object DEFAULT {}`,
  `DEFINE FIELD IF NOT EXISTS created_at ON workflow TYPE datetime DEFAULT time::now()`,
  `DEFINE FIELD IF NOT EXISTS last_run_at ON workflow TYPE option<datetime>`,
  `DEFINE TABLE IF NOT EXISTS workflow_run SCHEMAFULL`,
  `DEFINE FIELD IF NOT EXISTS id ON workflow_run TYPE string`,
  `DEFINE FIELD IF NOT EXISTS workflow_id ON workflow_run TYPE string`,
  `DEFINE FIELD IF NOT EXISTS tenant_id ON workflow_run TYPE string`,
  `DEFINE FIELD IF NOT EXISTS status ON workflow_run TYPE string DEFAULT 'queued'`,
  `DEFINE FIELD IF NOT EXISTS log ON workflow_run FLEXIBLE TYPE array DEFAULT []`,
  `DEFINE FIELD IF NOT EXISTS event_context ON workflow_run FLEXIBLE TYPE object DEFAULT {}`,
  `DEFINE FIELD IF NOT EXISTS started_at ON workflow_run TYPE datetime DEFAULT time::now()`,
  `DEFINE FIELD IF NOT EXISTS finished_at ON workflow_run TYPE option<datetime>`,
];

/** Legacy webhook model (token URL) → OpenHands model (source + whsec secret). */
const WEBHOOK_LEGACY_FIELDS = ['token', 'source_type', 'url'] as const;

async function migrateWebhookEndpoints(db: Surreal): Promise<void> {
  for (const field of WEBHOOK_LEGACY_FIELDS) {
    try {
      await db.query(`REMOVE FIELD IF EXISTS ${field} ON TABLE webhook_endpoint`);
    } catch {
      // Table may not exist on a fresh install.
    }
  }

  const dataSteps = [
    `UPDATE webhook_endpoint SET secret = secret ?? token WHERE (secret IS NONE OR secret = '') AND token IS NOT NONE`,
    `UPDATE webhook_endpoint SET source = source ?? source_type ?? 'custom' WHERE source IS NONE OR source = ''`,
    `UPDATE webhook_endpoint SET name = name ?? source ?? 'Webhook' WHERE name IS NONE OR name = ''`,
    `UPDATE webhook_endpoint SET event_key_expr = event_key_expr ?? 'type' WHERE event_key_expr IS NONE OR event_key_expr = ''`,
    `UPDATE webhook_endpoint SET signature_header = 'X-Hub-Signature-256' WHERE (signature_header IS NONE OR signature_header = '') AND source = 'github'`,
    `UPDATE webhook_endpoint SET signature_header = 'X-Signature-256' WHERE signature_header IS NONE OR signature_header = ''`,
    `UPDATE webhook_endpoint UNSET token, source_type, url`,
    `DELETE webhook_endpoint WHERE secret IS NONE OR secret = '' OR source IS NONE OR source = ''`,
  ];

  for (const sql of dataSteps) {
    try {
      await db.query(sql);
    } catch {
      // Best-effort: field names differ across legacy DB versions.
    }
  }
}

export async function initSchema(db: Surreal): Promise<void> {
  for (const sql of SCHEMA_STATEMENTS) {
    try {
      await db.query(sql);
    } catch (err) {
      // Schema statements are idempotent (IF NOT EXISTS). A failure here means
      // the store is in a bad state; fail loudly instead of booting with a
      // partially-defined schema that would cause confusing runtime errors.
      throw new Error(
        `[db] failed to apply schema statement: ${sql.slice(0, 80)}\n${String(err)}`,
        { cause: err },
      );
    }
  }

  await migrateWebhookEndpoints(db);
}
