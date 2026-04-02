// api/contract.js — EngageChain REST-style endpoints
// Wraps GenLayer JSON-RPC into simple POST endpoints for external apps.
//
// CONTRACT: 0x102625d1C7329faD69057744B38e2C924afd3dB4
// NETWORK:  GenLayer Studionet
//
// ─── Endpoints ──────────────────────────────────────────────────────────────
//
// POST /api/contract
// Body: { "method": "<method_name>", "args": [...] }
//
// READ methods (no wallet needed):
//   get_total_submissions       args: []
//   get_all_opinions            args: []
//   get_resolution_data         args: ["<opinion_id>"]
//   get_status                  args: ["<opinion_id>"]
//
// WRITE methods (require "privateKey" in body):
//   submit_opinion              args: ["<text>"]
//   evaluate_opinion            args: ["<opinion_id>"]
//   finalize_opinion            args: ["<opinion_id>", "<verdict>"]
//
// ─── Example reads ──────────────────────────────────────────────────────────
//   curl -X POST https://your-app.vercel.app/api/contract \
//     -H "Content-Type: application/json" \
//     -d '{"method":"get_total_submissions","args":[]}'
//
//   curl -X POST https://your-app.vercel.app/api/contract \
//     -H "Content-Type: application/json" \
//     -d '{"method":"get_resolution_data","args":["0"]}'
//
// ─── Example writes ─────────────────────────────────────────────────────────
//   curl -X POST https://your-app.vercel.app/api/contract \
//     -H "Content-Type: application/json" \
//     -d '{"method":"submit_opinion","args":["My opinion text"],"privateKey":"0x..."}'

const https = require('https');
const crypto = require('crypto');

const CONTRACT = '0x102625d1C7329faD69057744B38e2C924afd3dB4';
const ZERO     = '0x0000000000000000000000000000000000000000';
const HOSTS    = [
  { hostname: 'studio.genlayer.com', port: 443  },
  { hostname: 'studio.genlayer.com', port: 8443 },
];
const PATH     = '/api';
const TIMEOUT  = 55000;

const READ_METHODS = new Set([
  'get_total_submissions', 'get_all_opinions',
  'get_resolution_data',   'get_status',
]);

// ── Raw HTTPS request ────────────────────────────────────────────────────────
function rpcRequest(body) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  return new Promise((resolve, reject) => {
    let done = false;
    for (const host of HOSTS) {
      if (done) break;
      const req = https.request(
        { hostname: host.hostname, port: host.port, path: PATH, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length } },
        (upstream) => {
          if (done) return; done = true;
          const chunks = [];
          upstream.on('data', c => chunks.push(c));
          upstream.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch (e) { reject(new Error('Non-JSON response from studionet')); }
          });
          upstream.on('error', reject);
        }
      );
      req.on('error', (e) => { if (!done) { done = true; reject(e); } });
      req.setTimeout(TIMEOUT, () => req.destroy(new Error('Timeout')));
      req.write(buf); req.end();
      break; // try first host; failure caught above triggers reject
    }
  });
}

// ── gen_call (read) ──────────────────────────────────────────────────────────
async function readContract(method, args) {
  const resp = await rpcRequest({
    jsonrpc: '2.0', id: Date.now(), method: 'gen_call',
    params: [{
      from: ZERO, to: CONTRACT, type: 'read',
      data: { function: method, args },
      status: 'accepted',
    }],
  });
  if (resp.error) throw new Error(resp.error.message || JSON.stringify(resp.error));
  return resp.result;
}

// ── send_raw_transaction (write) ─────────────────────────────────────────────
// GenLayer write flow: build tx → sign with private key → send raw
// Uses eth_sendRawTransaction with GenLayer-specific encoding
async function writeContract(method, args, privateKey) {
  // Build the transaction payload
  const txData = {
    to:           CONTRACT,
    data:         { function: method, args },
    nonce:        Date.now(),
    gas_limit:    500000,
    value:        '0x0',
  };

  // For studionet we use gen_sendTransaction (GenLayer's own method)
  // which accepts unsigned tx + private key for server-side signing
  const resp = await rpcRequest({
    jsonrpc: '2.0', id: Date.now(), method: 'gen_sendTransaction',
    params: [{
      from:     deriveAddress(privateKey),
      to:       CONTRACT,
      data:     { function: method, args },
      value:    '0x0',
      private_key: privateKey,
    }],
  });

  if (resp.error) throw new Error(resp.error.message || JSON.stringify(resp.error));
  return resp.result; // txHash
}

// Simple address derivation placeholder — real apps use genlayer-js
function deriveAddress(privateKey) {
  // For studionet, the private key is passed directly to gen_sendTransaction
  // The server derives the address server-side
  return ZERO;
}

// ── Wait for finalization ────────────────────────────────────────────────────
async function waitFinalized(txHash, maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const resp = await rpcRequest({
        jsonrpc: '2.0', id: Date.now(), method: 'gen_getTransactionReceipt',
        params: [txHash],
      });
      if (resp.result && resp.result.status === 'FINALIZED') {
        return resp.result;
      }
    } catch (_) { /* keep polling */ }
  }
  throw new Error('Transaction did not finalize within ' + maxWaitMs / 1000 + 's');
}

// ── Handler ──────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' });

  const { method, args = [], privateKey } = req.body || {};

  if (!method) {
    return res.status(400).json({ error: 'Missing "method" in request body' });
  }

  const isRead = READ_METHODS.has(method);

  if (!isRead && !privateKey) {
    return res.status(400).json({
      error: `"${method}" is a write method. Provide "privateKey" in the request body.`,
    });
  }

  try {
    if (isRead) {
      const result = await readContract(method, args);
      return res.status(200).json({ ok: true, result });
    } else {
      const txHash = await writeContract(method, args, privateKey);
      const receipt = await waitFinalized(txHash);
      return res.status(200).json({ ok: true, txHash, result: receipt?.result ?? null });
    }
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
};
