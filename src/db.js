import pg from 'pg';
const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false } });
export async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS crypto_trades (
    id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT, buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'LTC', amount_display TEXT NOT NULL, item_description TEXT NOT NULL,
    invoice_id TEXT UNIQUE NOT NULL, payment_url TEXT, payment_address TEXT, payment_txid TEXT,
    status TEXT NOT NULL DEFAULT 'awaiting_payment', expires_at TIMESTAMPTZ, dispute_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}
export async function getTrade(id, guildId) { const r = await pool.query('SELECT * FROM crypto_trades WHERE id=$1 AND guild_id=$2', [id, guildId]); return r.rows[0]; }
export async function getByInvoice(invoiceId) { const r = await pool.query('SELECT * FROM crypto_trades WHERE invoice_id=$1', [invoiceId]); return r.rows[0]; }
export async function updateTrade(id, fields) { const entries = Object.entries(fields); const values = entries.map(([,v])=>v); const sets = entries.map(([k],i)=>`${k}=$${i+1}`); values.push(id); await pool.query(`UPDATE crypto_trades SET ${sets.join(',')}, updated_at=NOW() WHERE id=$${values.length}`, values); }
