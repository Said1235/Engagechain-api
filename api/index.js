/**
 * EngageChain API v2 — api/index.js
 *
 * Dual-mode: Vercel serverless function + Express router (Railway/Heroku/VPS).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ENDPOINTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  GET  /                               API info + endpoint reference
 *  GET  /health                         Health check
 *
 *  GET  /opinions                       List opinions
 *  GET  /opinions/count                 Total count
 *  GET  /opinions/:id                   Full opinion data
 *  GET  /opinions/:id/status            Status only
 *
 *  POST /opinions                       Submit opinion
 *  POST /opinions/:id/evaluate          Evaluate with GenLayer AI
 *  POST /opinions/:id/evaluate/external Validate with external AI analysis
 *  POST /opinions/:id/finalize          Finalize with verdict
 *
 *  POST /rpc                            Raw JSON-RPC proxy
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ENV VARS
 * ─────────────────────────────────────────────────────────────────────────────
 *  CONTRACT_ADDRESS   deployed contract address (required)
 *  GENLAYER_RPC       RPC endpoint (default: studionet)
 *  PRIVATE_KEY        fallback signing key (optional — auto-generates if absent)
 *  PORT               HTTP port for server.js (default: 3000)
 */

'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────
const GENLAYER_RPC     = process.env.GENLAYER_RPC || 'https://studio.genlayer.com:8443/api';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x15322146FdF38a93F5F4eBB88499A49A2199A6f2';
const ZERO_ADDR        = '0x0000000000000000000000000000000000000000';

// ─── GenLayer SDK — loaded once, lazily ──────────────────────────────────────
// Uses the npm package (genlayer-js) — works in Node.js on Vercel, Railway, Heroku.
// URL imports (esm.sh) do NOT work in Node.js.
let _glCache = null;
async function getGL() {
  if (_glCache) return _glCache;
  const gl      = require('genlayer-js');
  const chains  = require('genlayer-js/chains');
  _glCache = { gl, chains };
  return _glCache;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function parseWait(body, headers) {
  const raw = (body && body.wait) || headers['x-wait-status'] || 'finalized';
  const v   = String(raw).toUpperCase();
  return (v === 'ACCEPTED') ? 'ACCEPTED' : 'FINALIZED';
}

function parseFields(query) {
  if (!query || !query.fields) return null;
  return String(query.fields).split(',').map(f => f.trim()).filter(Boolean);
}

function applyFields(obj, fields) {
  if (!fields || !fields.length) return obj;
  const out = {};
  fields.forEach(f => { if (f in obj) out[f] = obj[f]; });
  return out;
}

function parseMeta(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return raw; }
}

function normaliseTotal(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') { const p = parseInt(raw, 10); return isNaN(p) ? null : p; }
  if (typeof raw === 'object') {
    const vals = Object.values(raw);
    if (vals.length === 1) { const p = parseInt(String(vals[0]), 10); return isNaN(p) ? null : p; }
  }
  return null;
}

// ─── GenLayer read — raw JSON-RPC gen_call ────────────────────────────────────

async function genCall(method, args) {
  args = args || [];
  if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS env var is not set');
  const body = JSON.stringify({
    jsonrpc: '2.0', id: Date.now(), method: 'gen_call',
    params: [{ from: ZERO_ADDR, to: CONTRACT_ADDRESS,
               type: 'read', data: { function: method, args }, status: 'accepted' }],
  });
  const res  = await fetch(GENLAYER_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

// ─── GenLayer write — uses npm genlayer-js (Node.js compatible) ──────────────

async function genWrite(method, args, privateKey, waitStatus) {
  args       = args       || [];
  waitStatus = waitStatus || 'FINALIZED';
  if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS env var is not set');

  const { gl, chains } = await getGL();

  // Build account from key or generate a fresh studionet account
  let account;
  const key = privateKey || process.env.PRIVATE_KEY;
  if (key) {
    // createAccount accepts a private key string
    account = gl.createAccount(key.startsWith('0x') ? key : '0x' + key);
  } else {
    account = gl.createAccount();
  }

  const client = gl.createClient({
    chain:    chains.studionet,
    account,
    endpoint: GENLAYER_RPC,
  });

  const txHash = await client.writeContract({
    address:      CONTRACT_ADDRESS,
    functionName: method,
    args,
    value:        BigInt(0),
  });

  const receipt = await client.waitForTransactionReceipt({
    hash:     txHash,
    status:   waitStatus,
    interval: 3000,
    retries:  120,
  });

  if (receipt && receipt.txExecutionResultName && receipt.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    throw new Error('Contract execution failed: ' + receipt.txExecutionResultName);
  }

  const result = (receipt && (receipt.result || receipt.return_value)) || null;
  return { txHash, result };
}

// ─── Raw RPC proxy ────────────────────────────────────────────────────────────

async function rawProxy(body) {
  const res = await fetch(GENLAYER_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

// ─── API info ─────────────────────────────────────────────────────────────────

function apiInfo() {
  return {
    name:     'EngageChain API',
    version:  '2.0.0',
    contract: CONTRACT_ADDRESS,
    network:  GENLAYER_RPC,
    docs:     'https://github.com/Said1235/Engagechain',
    endpoints: {
      'GET  /':                               'API info',
      'GET  /health':                         'Health check',
      'GET  /opinions':                       'List opinions. Params: ?status= ?source= ?limit= ?offset= ?fields=',
      'GET  /opinions/count':                 'Total submissions count',
      'GET  /opinions/:id':                   'Full opinion. Params: ?fields= ?parse_ai= ?parse_metadata=',
      'GET  /opinions/:id/status':            'Status only',
      'POST /opinions':                       'Submit. Body: { text, metadata?, wait? }',
      'POST /opinions/:id/evaluate':          'GenLayer AI eval. Body: { wait? }',
      'POST /opinions/:id/evaluate/external': 'External AI. Body: { analysis, wait? }',
      'POST /opinions/:id/finalize':          'Finalize. Body: { verdict, wait? }',
      'POST /rpc':                            'Raw JSON-RPC proxy to studionet',
    },
    auth: {
      header:    'X-Private-Key: 0x<your_key>',
      env:       'PRIVATE_KEY=0x<your_key>',
      fallback:  'Auto-generates a fresh studionet account if no key provided',
    },
  };
}

// ─── Main router ──────────────────────────────────────────────────────────────

async function handleRequest(method, path, body, headers, query) {
  body    = body    || {};
  query   = query   || {};
  headers = headers || {};
  const pk = headers['x-private-key'] || headers['X-Private-Key'];

  if (method === 'GET'  && path === '/')        return apiInfo();
  if (method === 'GET'  && path === '/health')  return { status: 'ok', contract: CONTRACT_ADDRESS, rpc: GENLAYER_RPC };
  if (method === 'POST' && path === '/rpc')     return rawProxy(body);

  // ── GET /opinions ──────────────────────────────────────────────────────
  if (method === 'GET' && path === '/opinions') {
    const raw    = await genCall('get_all_opinions', []);
    const allIds = Object.keys(raw || {});
    const limit  = Math.min(Math.max(parseInt(query.limit  || '100', 10), 1), 500);
    const offset = Math.max(parseInt(query.offset || '0',   10), 0);
    const fields = parseFields(query);
    const needsFull = !!(query.status || query.source || fields);

    if (needsFull) {
      const fullItems = await Promise.all(allIds.map(id =>
        genCall('get_resolution_data', [id]).catch(() => null)
      ));
      let filtered = fullItems.filter(item => {
        if (!item) return false;
        if (query.status && item.status !== query.status) return false;
        if (query.source && item.source !== query.source) return false;
        return true;
      });
      const total_filtered = filtered.length;
      filtered = filtered.slice(offset, offset + limit);
      const results = filtered.map(item => applyFields(item, fields));
      return { total: allIds.length, total_filtered, limit, offset, count: results.length, opinions: results };
    }

    const paginated = allIds.slice(offset, offset + limit);
    const opinions  = {};
    paginated.forEach(id => { opinions[id] = raw[id]; });
    return { total: allIds.length, limit, offset, count: paginated.length, opinions };
  }

  // ── GET /opinions/count ────────────────────────────────────────────────
  if (method === 'GET' && path === '/opinions/count') {
    const raw = await genCall('get_total_submissions', []);
    return { total: normaliseTotal(raw) };
  }

  // ── GET /opinions/:id ──────────────────────────────────────────────────
  const matchId = path.match(/^\/opinions\/([^/]+)$/);
  if (matchId && method === 'GET') {
    const fields = parseFields(query);
    let item = await genCall('get_resolution_data', [matchId[1]]);
    if (query.parse_ai === 'true' && item && item.ai_response) {
      try { item = Object.assign({}, item, { ai_response: JSON.parse(item.ai_response) }); } catch (_) {}
    }
    if (query.parse_metadata === 'true' && item && item.metadata) {
      item = Object.assign({}, item, { metadata: parseMeta(item.metadata) });
    }
    return applyFields(item, fields);
  }

  // ── GET /opinions/:id/status ───────────────────────────────────────────
  const matchStatus = path.match(/^\/opinions\/([^/]+)\/status$/);
  if (matchStatus && method === 'GET') {
    const status = await genCall('get_status', [matchStatus[1]]);
    return { id: matchStatus[1], status: String(status) };
  }

  // ── POST /opinions ─────────────────────────────────────────────────────
  if (method === 'POST' && path === '/opinions') {
    const text = body.text;
    if (!text || typeof text !== 'string') throw new Error('body.text is required (string)');
    if (text.trim().length === 0)          throw new Error('body.text cannot be empty');
    if (text.length > 2000)                throw new Error('body.text cannot exceed 2000 characters');

    let metaStr = '';
    if (body.metadata !== undefined && body.metadata !== null) {
      metaStr = typeof body.metadata === 'string' ? body.metadata : JSON.stringify(body.metadata);
      if (metaStr.length > 4000) throw new Error('body.metadata cannot exceed 4000 characters');
    }

    const waitStatus = parseWait(body, headers);
    const out        = await genWrite('submit_opinion', [text, metaStr], pk, waitStatus);
    return { opinion_id: String(out.result), txHash: out.txHash, status: 'pending', metadata: metaStr ? parseMeta(metaStr) : null, wait: waitStatus };
  }

  // ── POST /opinions/:id/evaluate ────────────────────────────────────────
  const matchEval = path.match(/^\/opinions\/([^/]+)\/evaluate$/);
  if (matchEval && method === 'POST') {
    const id         = matchEval[1];
    const waitStatus = parseWait(body, headers);
    const out        = await genWrite('evaluate_opinion', [id], pk, waitStatus);
    let ai_response  = out.result;
    if (typeof ai_response === 'string') { try { ai_response = JSON.parse(ai_response); } catch (_) {} }
    return { opinion_id: id, txHash: out.txHash, status: 'evaluated', ai_response, wait: waitStatus };
  }

  // ── POST /opinions/:id/evaluate/external ──────────────────────────────
  const matchExt = path.match(/^\/opinions\/([^/]+)\/evaluate\/external$/);
  if (matchExt && method === 'POST') {
    const id       = matchExt[1];
    const analysis = body.analysis;
    if (!analysis) throw new Error('body.analysis is required (object or JSON string)');
    const analysisStr = typeof analysis === 'string' ? analysis : JSON.stringify(analysis);
    if (analysisStr.length > 10000) throw new Error('body.analysis cannot exceed 10000 characters');
    const waitStatus = parseWait(body, headers);
    const out        = await genWrite('submit_with_external_ai', [id, analysisStr], pk, waitStatus);
    return { opinion_id: id, txHash: out.txHash, status: 'evaluated', source: 'external', ai_response: parseMeta(analysisStr), wait: waitStatus };
  }

  // ── POST /opinions/:id/finalize ────────────────────────────────────────
  const matchFin = path.match(/^\/opinions\/([^/]+)\/finalize$/);
  if (matchFin && method === 'POST') {
    const id      = matchFin[1];
    const verdict = body.verdict;
    if (!verdict || typeof verdict !== 'string') throw new Error('body.verdict is required (string)');
    if (verdict.trim().length === 0)             throw new Error('body.verdict cannot be empty');
    const waitStatus = parseWait(body, headers);
    const out        = await genWrite('finalize_opinion', [id, verdict], pk, waitStatus);
    return { opinion_id: id, txHash: out.txHash, status: 'finalized', verdict, wait: waitStatus };
  }

  const err = new Error('Not found: ' + method + ' ' + path);
  err.status = 404;
  throw err;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function respond(res, data, status) {
  res.status(status || 200).json(Object.assign({ ok: true }, data));
}

function respondError(res, err) {
  res.status(err.status || 500).json({ ok: false, error: err.message });
}

function parseQuery(url) {
  try { const u = new URL('http://x' + url); const q = {}; u.searchParams.forEach((v, k) => { q[k] = v; }); return q; }
  catch (_) { return {}; }
}

// ─── Vercel export ────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Private-Key, X-Wait-Status');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path  = (req.url || '/').replace(/^\/api/, '').split('?')[0] || '/';
  const query = parseQuery(req.url || '/');

  try {
    const data = await handleRequest(req.method, path, req.body, req.headers, query);
    respond(res, typeof data === 'object' && data !== null ? data : { data });
  } catch (err) {
    respondError(res, err);
  }
};

// ─── Express router export (Railway / Heroku / VPS) ──────────────────────────

let _router = null;

function getRouter() {
  if (_router) return _router;
  try {
    const express = require('express');
    _router = express.Router();

    _router.use(function(req, res, next) {
      res.setHeader('Access-Control-Allow-Origin',  '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Private-Key, X-Wait-Status');
      if (req.method === 'OPTIONS') return res.status(200).end();
      next();
    });

    _router.all('*', async function(req, res) {
      try {
        const data = await handleRequest(req.method, req.path, req.body, req.headers, req.query);
        respond(res, typeof data === 'object' && data !== null ? data : { data });
      } catch (err) {
        respondError(res, err);
      }
    });
  } catch (_) { /* express not installed */ }
  return _router;
}

Object.defineProperty(module.exports, 'router', { get: getRouter });
