const base = (process.env.APIRONE_API_URL || 'https://api.apirone.com/v2').replace(/\\/$/, '');

function headers() {
  const h = { 'content-type': 'application/json', accept: 'application/json' };
  if (process.env.APIRONE_API_KEY) h.authorization = `Bearer ${process.env.APIRONE_API_KEY}`;
  return h;
}

export async function createInvoice({ tradeId, amount, description }) {
  const response = await fetch(`${base}/invoices`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({
      currency: process.env.APIRONE_CURRENCY || 'LTC',
      amount,
      lifetime: Number(process.env.INVOICE_LIFETIME_SECONDS || 3600),
      description: description.slice(0, 500),
      order_id: String(tradeId),
      callback_url: `${process.env.PUBLIC_BASE_URL}/webhooks/apirone`,
      callback_secret: process.env.APIRONE_WEBHOOK_SECRET
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Apirone invoice error (${response.status}): ${body.message || body.error || 'request failed'}`);
  const invoice = body.invoice || body;
  const id = invoice.id || invoice.invoice_id;
  const payUrl = invoice.payment_url || invoice.url || invoice.hosted_url;
  const address = invoice.address || invoice.payment_address;
  if (!id || (!payUrl && !address)) throw new Error('Apirone response did not include an invoice ID and payment destination. Check the Apirone API version and response format.');
  return { id: String(id), payUrl: payUrl || null, address: address || null, raw: body };
}

export function webhookIsValid(req) {
  const expected = process.env.APIRONE_WEBHOOK_SECRET;
  if (!expected) return false;
  const supplied = req.get('x-apirone-secret') || req.get('x-webhook-secret') || req.body?.callback_secret;
  return supplied === expected;
}

export function paymentState(payload) {
  const source = payload.invoice || payload;
  return {
    invoiceId: String(source.id || source.invoice_id || source.order_id || ''),
    status: String(source.status || source.state || '').toLowerCase(),
    txid: source.txid || source.tx_hash || source.transaction_id || null,
    paidAmount: source.paid_amount || source.amount_paid || null
  };
}
