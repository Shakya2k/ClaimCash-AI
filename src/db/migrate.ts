import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("=== ClaimCash AI Database Migration ===");
  console.log("\nDropping existing tables...");
  const tables = ["email_drafts","invoice_items","tasks","invoice_claims","sessions","invoices","collection_tasks","audit_log","email_templates","organization_members","insurance_claims","claims","contacts","users","organizations"];
  for (const t of tables) {
    await sql.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
  }
  console.log("  ✓ All existing tables dropped");

  console.log("\nCreating tables...");
  await sql`CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text UNIQUE NOT NULL, subscription_status text NOT NULL DEFAULT 'trial' CHECK (subscription_status IN ('trial','active','past_due','canceled','incomplete')), trial_ends_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`;
  console.log("  ✓ organizations");
  await sql`CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, password_hash text NOT NULL, name text NOT NULL, role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','viewer')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  console.log("  ✓ users");
  await sql`CREATE TABLE organization_members (user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','viewer')), invited_by uuid REFERENCES users(id), joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, org_id))`;
  console.log("  ✓ organization_members");
  await sql`CREATE TABLE sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
  console.log("  ✓ sessions");
  await sql`CREATE TABLE contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, type text NOT NULL CHECK (type IN ('adjuster','homeowner','commercial','property_manager')), name text NOT NULL, email text, phone text, company text, notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  console.log("  ✓ contacts");
  await sql`CREATE TABLE insurance_claims (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, claim_number text NOT NULL, insurance_company text NOT NULL, adjuster_name text, adjuster_email text, adjuster_phone text, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','approved','denied','paid','closed')), filed_date date, estimated_amount numeric(12,2), notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id, claim_number))`;
  console.log("  ✓ insurance_claims");
  await sql`CREATE TABLE invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, qbo_id text, invoice_number text NOT NULL, customer_name text NOT NULL, amount numeric(12,2) NOT NULL DEFAULT 0, amount_paid numeric(12,2) NOT NULL DEFAULT 0, balance_due numeric(12,2) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','overdue','paid','partially_paid','written_off')), due_date date, invoice_date date, aging_bucket text CHECK (aging_bucket IN ('current','30','60','90_plus')), description text, missing_docs text[] DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id, invoice_number))`;
  console.log("  ✓ invoices");
  await sql`CREATE TABLE invoice_claims (invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, claim_id uuid NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (invoice_id, claim_id))`;
  console.log("  ✓ invoice_claims");
  await sql`CREATE TABLE collection_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, invoice_id uuid REFERENCES invoices(id), title text NOT NULL, description text, priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled')), due_date timestamptz, assigned_to uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  console.log("  ✓ collection_tasks");
  await sql`CREATE TABLE email_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name text NOT NULL, subject text NOT NULL, body text NOT NULL, type text NOT NULL DEFAULT 'collection' CHECK (type IN ('collection','reminder','follow_up','custom')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  console.log("  ✓ email_templates");
  await sql`CREATE TABLE audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid REFERENCES organizations(id), user_id uuid REFERENCES users(id), action text NOT NULL, entity_type text NOT NULL, entity_id uuid, details jsonb DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now())`;
  console.log("  ✓ audit_log");

  console.log("\nCreating indexes...");
  const indexes = [
    "idx_org_members_user ON organization_members(user_id)",
    "idx_org_members_org ON organization_members(org_id)",
    "idx_sessions_user ON sessions(user_id)",
    "idx_sessions_token ON sessions(token_hash)",
    "idx_contacts_org ON contacts(org_id)",
    "idx_claims_org ON insurance_claims(org_id)",
    "idx_invoices_org ON invoices(org_id)",
    "idx_invoices_status ON invoices(org_id, status)",
    "idx_invoices_due ON invoices(org_id, due_date)",
    "idx_invoices_aging ON invoices(org_id, aging_bucket)",
    "idx_invoice_claims_inv ON invoice_claims(invoice_id)",
    "idx_invoice_claims_clm ON invoice_claims(claim_id)",
    "idx_tasks_org ON collection_tasks(org_id)",
    "idx_tasks_assigned ON collection_tasks(assigned_to)",
    "idx_tasks_status ON collection_tasks(org_id, status)",
    "idx_email_templates_org ON email_templates(org_id)",
    "idx_audit_log_org ON audit_log(org_id)",
    "idx_audit_log_created ON audit_log(created_at)",
  ];
  for (const idx of indexes) {
    await sql.query(`CREATE INDEX IF NOT EXISTS ${idx}`);
  }
  console.log("  ✓ all indexes created");

  const result = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
  console.log("\n✅ Migration complete! Created tables:");
  for (const r of result) console.log(`   - ${r.table_name}`);
}

migrate().catch((err) => { console.error("Migration failed:", err); process.exit(1); });