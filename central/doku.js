// DOKU Checkout client (https://developers.doku.com): create a payment page, verify HTTP notifications, check order status. Zero dependencies.
// Signature (non-SNAP): HMAC-SHA256, key = Secret Key, over the lines (joined by "\n", no trailing newline)
//   Client-Id:<id> / Request-Id:<id> / Request-Timestamp:<UTC ISO, no ms> / Request-Target:<path> / Digest:<base64 sha256 of the body> (POST only)
// and sent as "Signature: HMACSHA256=<base64>". For notifications DOKU signs with the path of OUR notification URL as Request-Target.
// Environment: DOKU_CLIENT_ID, DOKU_SECRET_KEY, PUBLIC_URL (e.g. https://clipper.hellens.dev/api, where this server is reachable),
//   DOKU_ENV=production (default sandbox), DOKU_NOTIFY_URL (optional full notification URL, sent per request as override_notification_url),
//   DOKU_BASE (override the API host, used by tests).
const crypto = require('crypto');

const cfg = () => ({
  clientId: process.env.DOKU_CLIENT_ID || '', secret: process.env.DOKU_SECRET_KEY || '',
  base: process.env.DOKU_BASE || (process.env.DOKU_ENV === 'production' ? 'https://api.doku.com' : 'https://api-sandbox.doku.com'),
  notifyUrl: process.env.DOKU_NOTIFY_URL || '', publicBase: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
});
const enabled = () => { const c = cfg(); return !!(c.clientId && c.secret && c.publicBase); };
const digest = body => crypto.createHash('sha256').update(body).digest('base64');
const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// body: string/Buffer for POST, null/undefined for GET (then no Digest line).
function sign({ clientId, secret, requestId, timestamp, target, body }) {
  const lines = [`Client-Id:${clientId}`, `Request-Id:${requestId}`, `Request-Timestamp:${timestamp}`, `Request-Target:${target}`];
  if (body != null) lines.push('Digest:' + digest(body));
  return 'HMACSHA256=' + crypto.createHmac('sha256', secret).update(lines.join('\n')).digest('base64');
}

async function call(method, target, bodyObj) {
  const c = cfg(), body = bodyObj ? JSON.stringify(bodyObj) : null, requestId = crypto.randomUUID(), timestamp = stamp();
  const r = await fetch(c.base + target, { method, body: body ?? undefined, signal: AbortSignal.timeout(15000), headers: {
    'Content-Type': 'application/json', 'Client-Id': c.clientId, 'Request-Id': requestId, 'Request-Timestamp': timestamp,
    Signature: sign({ clientId: c.clientId, secret: c.secret, requestId, timestamp, target, body }) } });
  const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 300) }; }
  return { status: r.status, j };
}

// DOKU answers with {error:{code,message}} (auth problems) or {error_messages:[...]} (validation). Turn the common credential mistakes into something fixable.
function explain(status, j) {
  const env = cfg().base.includes('sandbox') ? 'sandbox' : 'production', e = j && j.error && typeof j.error === 'object' ? j.error : null;
  if (e && e.code === 'invalid_client_id') return `DOKU: Client ID tidak dikenal di lingkungan ${env}. Pastikan Client ID dan Secret Key diambil dari mode ${env} yang sama di DOKU Dashboard.`;
  if (e && e.code === 'invalid_signature') return `DOKU: tanda tangan ditolak. Secret Key tidak cocok dengan Client ID untuk lingkungan ${env}; salin keduanya dari halaman yang sama.`;
  const m = e ? e.message : j && (j.error_messages || j.message);
  return 'DOKU menolak permintaan: ' + (m ? [].concat(m).join('; ') : 'HTTP ' + status);
}

// Create a hosted checkout page. Returns { url, expiredDate }; throws Error(message) with DOKU's own message on failure.
async function createCheckout({ invoice, amount, title, customer, callbackUrl, dueMinutes = 60 }) {
  const c = cfg();
  const body = { order: { amount, invoice_number: invoice, currency: 'IDR', callback_url: callbackUrl, auto_redirect: true, line_items: [{ name: title.slice(0, 80), price: amount, quantity: 1 }] },
    payment: { payment_due_date: dueMinutes }, customer: { id: String(customer.id), name: customer.name, email: customer.email } };
  if (c.notifyUrl) body.additional_info = { override_notification_url: c.notifyUrl };
  const { status, j } = await call('POST', '/checkout/v1/payment', body);
  const url = j && j.response && j.response.payment && j.response.payment.url;
  if (status !== 200 || !url) throw new Error(explain(status, j));
  return { url, expiredDate: j.response.payment.expired_date || null };
}

// Order status straight from DOKU ("SUCCESS" | "PENDING" | "FAILED" | "EXPIRED" ...) or null when it cannot be read
// (the Check Status API is enabled per merchant, so callers must not treat null as failure).
async function statusOf(invoice) {
  try { const { status, j } = await call('GET', '/orders/v1/status/' + encodeURIComponent(invoice)); return status === 200 && j.transaction ? String(j.transaction.status || '').toUpperCase() : null; }
  catch { return null; }
}

// headers: Node's lowercase header map; raw: the exact request body Buffer; targets: acceptable Request-Target values (our path as DOKU saw it).
function verifyNotification(headers, raw, targets) {
  const c = cfg(), sig = String(headers.signature || ''), h = k => String(headers[k] || '');
  if (!c.secret || !sig || h('client-id') !== c.clientId || !h('request-id') || !h('request-timestamp')) return false;
  return targets.some(target => {
    const want = Buffer.from(sign({ clientId: c.clientId, secret: c.secret, requestId: h('request-id'), timestamp: h('request-timestamp'), target, body: raw })), got = Buffer.from(sig);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  });
}

module.exports = { explain, cfg, enabled, sign, stamp, call, createCheckout, statusOf, verifyNotification };
