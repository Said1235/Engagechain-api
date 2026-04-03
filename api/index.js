/**
 * EngageChain API — api/index.js
 *
 * Dual-mode: works as a Vercel serverless function AND
 * exports an Express router for Railway / Heroku via server.js.
 *
 * ─────────────────────────────────────────────────────────
 *  ENDPOINTS
 * ─────────────────────────────────────────────────────────
 *
 *  GET  /                          → API info + all endpoints
 *  GET  /health                    → health check
 *
 *  GET  /opinions                  → get_all_opinions()
 *  GET  /opinions/count            → get_total_submissions()
 *  GET  /opinions/:id              → get_resolution_data(id)
 *  GET  /opinions/:id/status       → get_status(id)
 *
 *  POST /opinions                  → submit_opinion(text)
 *  POST /opinions/:id/evaluate     → evaluate_opinion(id)
 *  POST /opinions/:id/evaluate/external → submit_with_external_ai(id, analysis)
 *  POST /opinions/:id/finalize     → finalize_opinion(id, verdict)
 *
 *  POST /rpc                       → raw JSON-RPC proxy (pass-through to GenLayer)
 *
 * ─────────────────────────────────────────────────────────
 *  WRITE ENDPOINTS — extra required headers:
 *    X-Private-Key : hex private key of the signing wallet
 *                    (auto-generated studionet key if omitted)
 * ─────────────────────────────────────────────────────────
 *
 *  CONFIG via environment variables:
 *    CONTRACT_ADDRESS  — deployed EngageChain contract address
 *    GENLAYER_RPC      — RPC endpoint (default: studionet)
 *    PRIVATE_KEY       — fallback signing key for write ops
 *    PORT              — port for server.js (default: 3000)
 */

'use strict';

const { Router } = (() => {
  try { return require('express'); }
  catch { return { Router: null }; }
})();

// ─── Config ──────────────────────────────────────────────────────────────────
const GENLAYER_RPC = process.env.GENLAYER_RPC || 'https://studio.genlayer.com:8443/api';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// ─── GenLayer RPC helpers ─────────────────────────────────────────────────────

async function genCall(method, args = []) {
  if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS env var not set');
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'gen_call',
    params: [{
      from:   ZERO_ADDR,
      to:     CONTRACT_ADDRESS,
      type:   'read',
      data:   { function: method, args },
      status: 'accepted',
    }],
  });
  const res  = await fetch(GENLAYER_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

async function genWrite(method, args = [], privateKey) {
  if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS env var not set');

  // Dynamically import genlayer-js (ESM) from esm.sh
  // We use a dynamic import so this works with older Node without bundler.
  const { createClient, createAccount } = await import('https://esm.sh/genlayer-js@latest');
  const { studionet }                   = await import('https://esm.sh/genlayer-js@latest/chains');

  let account;
  const key = privateKey || process.env.PRIVATE_KEY;
  if (key) {
    // Use provided key — works on studionet and testnet
    const { privateKeyToAccount } = await import('https://esm.sh/viem@latest/accounts');
    account = privateKeyToAccount(key.startsWith('0x') ? key : '0x' + key);
  } else {
    // Auto-generate — only works on studionet (auto-funded)
    account = createAccount();
  }

  const client = createClient({ chain: studionet, account, endpoint: GENLAYER_RPC });

  const txHash = await client.writeContract({
    address:      CONTRACT_ADDRESS,
    functionName: method,
    args,
    value: BigInt(0),
  });

  const receipt = await client.waitForTransactionReceipt({
    hash:     txHash,
    status:   'FINALIZED',
    interval: 3000,
    retries:  120,
  });

  if (receipt?.txExecutionResultName && receipt.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    throw new Error('Contract execution failed: ' + receipt.txExecutionResultName);
  }

  return {
    txHash,
    result: receipt?.result ?? receipt?.return_value ?? null,
  };
}

async function rawProxy(body) {
  const res  = await fetch(GENLAYER_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

// ─── Route handlers ───────────────────────────────────────────────────────────

function apiInfo() {
  return {
    name:     'EngageChain API',
    version:  '1.0.0',
    contract: CONTRACT_ADDRESS || '(CONTRACT_ADDRESS env var not set)',
    network:  GENLAYER_RPC,
    docs:     'https://github.com/your-org/engagechain-api',
    endpoints: {
      'GET  /':                             'API info',
      'GET  /health':                       'Health check',
      'GET  /opinions':                     'List all opinions {id: text}',
      'GET  /opinions/count':               'Total submissions count',
      'GET  /opinions/:id':                 'Full opinion data by ID',
      'GET  /opinions/:id/status':          'Status of one opinion',
      'POST /opinions':                     'Submit opinion. Body: { text }. Header: X-Private-Key (optional)',
      'POST /opinions/:id/evaluate':        'Evaluate with GenLayer AI. Header: X-Private-Key (optional)',
      'POST /opinions/:id/evaluate/external': 'Validate with external AI. Body: { analysis: {...} }. Header: X-Private-Key',
      'POST /opinions/:id/finalize':        'Finalize opinion. Body: { verdict }. Header: X-Private-Key',
      'POST /rpc':                          'Raw JSON-RPC proxy to GenLayer node',
    },
  };
}

async function handleRequest(method, path, body, headers) {
  const pk = headers['x-private-key'] || headers['X-Private-Key'];

  // GET /
  if (method === 'GET' && path === '/') return apiInfo();

  // GET /health
  if (method === 'GET' && path === '/health') {
    return { status: 'ok', contract: CONTRACT_ADDRESS, rpc: GENLAYER_RPC };
  }

  // POST /rpc — raw proxy
  if (method === 'POST' && path === '/rpc') {
    return rawProxy(body);
  }

  // GET /opinions
  if (method === 'GET' && path === '/opinions') {
    return genCall('get_all_opinions', []);
  }

  // GET /opinions/count
  if (method === 'GET' && path === '/opinions/count') {
    const total = await genCall('get_total_submissions', []);
    return { total: String(total) };
  }

  // GET /opinions/:id
  const matchId = path.match(/^\/opinions\/([^/]+)$/);
  if (matchId && method === 'GET') {
    return genCall('get_resolution_data', [matchId[1]]);
  }

  // GET /opinions/:id/status
  const matchStatus = path.match(/^\/opinions\/([^/]+)\/status$/);
  if (matchStatus && method === 'GET') {
    const status = await genCall('get_status', [matchStatus[1]]);
    return { id: matchStatus[1], status: String(status) };
  }

  // POST /opinions — submit
  if (method === 'POST' && path === '/opinions') {
    const text = body?.text;
    if (!text || typeof text !== 'string') throw new Error('body.text is required');
    if (text.length === 0)    throw new Error('text cannot be empty');
    if (text.length > 2000)   throw new Error('text cannot exceed 2000 characters');
    const out = await genWrite('submit_opinion', [text], pk);
    return { opinion_id: String(out.result), txHash: out.txHash, status: 'pending' };
  }

  // POST /opinions/:id/evaluate
  const matchEval = path.match(/^\/opinions\/([^/]+)\/evaluate$/);
  if (matchEval && method === 'POST') {
    const id  = matchEval[1];
    const out = await genWrite('evaluate_opinion', [id], pk);
    return { opinion_id: id, txHash: out.txHash, status: 'evaluated', ai_response: out.result };
  }

  // POST /opinions/:id/evaluate/external
  const matchExt = path.match(/^\/opinions\/([^/]+)\/evaluate\/external$/);
  if (matchExt && method === 'POST') {
    const id       = matchExt[1];
    const analysis = body?.analysis;
    if (!analysis) throw new Error('body.analysis is required (object or JSON string)');
    const analysisStr = typeof analysis === 'string' ? analysis : JSON.stringify(analysis);
    const out = await genWrite('submit_with_external_ai', [id, analysisStr], pk);
    return { opinion_id: id, txHash: out.txHash, status: 'evaluated', source: 'external', ai_response: out.result };
  }

  // POST /opinions/:id/finalize
  const matchFin = path.match(/^\/opinions\/([^/]+)\/finalize$/);
  if (matchFin && method === 'POST') {
    const id      = matchFin[1];
    const verdict = body?.verdict;
    if (!verdict || typeof verdict !== 'string') throw new Error('body.verdict is required');
    const out = await genWrite('finalize_opinion', [id, verdict], pk);
    return { opinion_id: id, txHash: out.txHash, status: 'finalized', verdict };
  }

  throw Object.assign(new Error('Not found: ' + method + ' ' + path), { status: 404 });
}

function respond(res, data, status) {
  status = status || 200;
  res.status(status).json({ ok: status < 400, ...data });
}

function respondError(res, err) {
  const status = err.status || 500;
  res.status(status).json({ ok: false, error: err.message });
}

// ─── Vercel serverless export ─────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Private-Key, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Normalise path — Vercel may include /api prefix
  const path = (req.url || '/').replace(/^\/api/, '') || '/';

  try {
    const data = await handleRequest(req.method, path, req.body, req.headers);
    respond(res, typeof data === 'object' && data !== null ? data : { data });
  } catch (err) {
    respondError(res, err);
  }
};

// ─── Express router export (for server.js → Railway / Heroku) ────────────────

if (Router) {
  const router = Router();

  router.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Private-Key, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
  });

  router.all('*', async (req, res) => {
    try {
      const data = await handleRequest(req.method, req.path, req.body, req.headers);
      respond(res, typeof data === 'object' && data !== null ? data : { data });
    } catch (err) {
      respondError(res, err);
    }
  });

  module.exports.router = router;
}
