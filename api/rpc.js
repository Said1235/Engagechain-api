// api/rpc.js — GenLayer studionet proxy
// Forwards JSON-RPC to studio.genlayer.com (CORS fix for browsers)
// Contract: 0x102625d1C7329faD69057744B38e2C924afd3dB4

const https = require('https');

const HOSTS = [
  { hostname: 'studio.genlayer.com', port: 443  },
  { hostname: 'studio.genlayer.com', port: 8443 },
];
const PATH    = '/api';
const TIMEOUT = 25000;

function tryHost(host, buf) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host.hostname, port: host.port, path: PATH, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error(`Timeout on port ${host.port}`)));
    req.write(buf); req.end();
  });
}

async function forward(body) {
  const buf = Buffer.from(body, 'utf8');
  let lastErr;
  for (const host of HOSTS) {
    try { return await tryHost(host, buf); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function errResp(id, msg) {
  return { jsonrpc: '2.0', id: id || null, error: { code: -32603, message: msg } };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json(errResp(null, 'Method not allowed'));

  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  let reqId;
  try { reqId = JSON.parse(body).id; } catch (_) {}

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const raw = await forward(body);
    let parsed;
    try   { parsed = JSON.parse(raw); }
    catch { return res.status(200).json(errResp(reqId, 'Non-JSON from studionet: ' + raw.slice(0, 100))); }
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(200).json(errResp(reqId, 'Cannot reach studionet: ' + err.message));
  }
};
