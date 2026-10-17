const trades = new Map();
let nextId = 1;

function clone(trade) {
  return trade ? { ...trade } : null;
}

export const pool = {
  async query(_sql, values = []) {
    const [guildId, buyerId, sellerId, amountDisplay, itemDescription, invoiceId] = values;
    const now = new Date();
    const trade = {
      id: nextId++,
      guild_id: guildId,
      buyer_id: buyerId,
      seller_id: sellerId,
      amount_display: amountDisplay,
      item_description: itemDescription,
      invoice_id: invoiceId,
      status: 'awaiting_payment',
      payment_url: null,
      payment_address: null,
      payment_txid: null,
      channel_id: null,
      dispute_reason: null,
      expires_at: null,
      created_at: now,
      updated_at: now
    };

    trades.set(trade.id, trade);
    return { rows: [clone(trade)] };
  }
};

export async function initDb() {
  console.log('Using temporary in-memory storage; no DATABASE_URL required.');
}

export async function getTrade(id, guildId) {
  const trade = trades.get(Number(id));
  if (!trade || (guildId && trade.guild_id !== guildId)) return null;
  return clone(trade);
}

export async function getByInvoice(invoiceId) {
  for (const trade of trades.values()) {
    if (String(trade.invoice_id) === String(invoiceId)) return clone(trade);
  }
  return null;
}

export async function updateTrade(id, changes) {
  const trade = trades.get(Number(id));
  if (!trade) return null;
  Object.assign(trade, changes, { updated_at: new Date() });
  return clone(trade);
}

export async function closeDb() {
  trades.clear();
}
