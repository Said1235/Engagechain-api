/**
 * EngageChain API v2 — api/index.js
 *
 * Dual-mode: CommonJS module (Express router for Railway/Heroku/VPS)
 *            + Vercel serverless handler via module.exports.
 *
 * ENDPOINTS
 *  GET  /                               API info
 *  GET  /health                         Health check
 *  GET  /opinions                       List  ?status= ?source= ?limit= ?offset= ?fields=
 *  GET  /opinions/count                 Total count
 *  GET  /opinions/:id                   Full opinion  ?fields= ?parse_ai= ?parse_metadata=
 *  GET  /opinions/:id/status            Status only
 *  POST /opinions                       Submit  { text, metadata?, wait? }
 *  POST /opinions/:id/evaluate          GenLayer AI  { wait? }
 *  POST /opinions/:id/evaluate/external External AI  { analysis, wait? }
 *  POST /opinions/:id/finalize          Finalize  { verdict, wait? }
 *  POST /rpc                            Raw JSON-RPC proxy
 *
 * AUTH: X-Private-Key header or PRIVATE_KEY env var (auto-generates key if absent)
 * ENV:  CONTRACT_ADDRESS (required), GENLAYER_RPC (optional), PRIVATE_KEY, PORT
 */

'use strict';

const https = require('https');

// ── Config ────────────────────────────────────────────────────────────────────
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x15322146FdF38a93F5F4eBB88499A49A2199A6f2';
const ZERO_ADDR        = '0x0000000000000000000000000000000000000000';
const CUSTOM_RPC       = process.env.GENLAYER_RPC || null;

// studio.genlayer.com:8443 = JSON-RPC API
// studio.genlayer.com:443  = Studio web UI (HTML) — NOT the API
const RPC_HOST    = 'studio.genlayer.com';
const RPC_PORT    = 8443;
const RPC_PATH    = '/api';
const RPC_TIMEOUT = 28000;

// ── Node https RPC (timeout-controlled, no hanging) ───────────────────────────
function httpsPost(hostname, port, path, bodyBuf) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, port, path, method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': bodyBuf.length,
        'Accept':         'application/json',
        'User-Agent':     'EngageChain-API/2.0',
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(RPC_TIMEOUT, () => req.destroy(new Error('RPC timeout after ' + (RPC_TIMEOUT/1000) + 's')));
    req.write(bodyBuf);
    req.end();
  });
}

async function rpcJSON(bodyString) {
  const buf = Buffer.from(typeof bodyString === 'string' ? bodyString : JSON.stringify(bodyString), 'utf8');
  let text;
  if (CUSTOM_RPC) {
    const u = new URL(CUSTOM_RPC);
    text = await httpsPost(u.hostname, parseInt(u.port || '443'), u.pathname, buf);
  } else {
    text = await httpsPost(RPC_HOST, RPC_PORT, RPC_PATH, buf);
  }
  let json;
  try { json = JSON.parse(text); }
  catch (_) { throw new Error('Studionet returned non-JSON: ' + text.trim().slice(0, 150)); }
  return json;
}

// ── genlayer-js — ESM-only, use dynamic import() (works in CJS async fn) ─────
let _glCache = null;
async function getGL() {
  if (_glCache) return _glCache;
  const [gl, chains] = await Promise.all([
    import('genlayer-js'),
    import('genlayer-js/chains'),
  ]);
  _glCache = { gl, chains };
  return _glCache;
}

// ── GenLayer read ─────────────────────────────────────────────────────────────
async function genCall(method, args = []) {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: Date.now(), method: 'gen_call',
    params: [{ from: ZERO_ADDR, to: CONTRACT_ADDRESS,
               type: 'read', data: { function: method, args }, status: 'accepted' }],
  });
  const json = await rpcJSON(body);
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

// ── GenLayer write ────────────────────────────────────────────────────────────
async function genWrite(method, args = [], privateKey, waitStatus = 'FINALIZED') {
  const { gl, chains } = await getGL();
  const key     = privateKey || process.env.PRIVATE_KEY;
  const account = key ? gl.createAccount(key.startsWith('0x') ? key : '0x' + key)
                      : gl.createAccount();
  const endpoint = CUSTOM_RPC || `https://${RPC_HOST}:${RPC_PORT}${RPC_PATH}`;
  const client   = gl.createClient({ chain: chains.studionet, account, endpoint });

  const txHash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName: method, args, value: BigInt(0) });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, status: waitStatus, interval: 3000, retries: 120 });

  if (receipt?.txExecutionResultName && receipt.txExecutionResultName !== 'FINISHED_WITH_RETURN')
    throw new Error('Contract failed: ' + receipt.txExecutionResultName);

  return { txHash, result: receipt?.result ?? receipt?.return_value ?? null };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const parseWait = (body, hdrs) => String((body?.wait) || hdrs['x-wait-status'] || 'finalized').toUpperCase() === 'ACCEPTED' ? 'ACCEPTED' : 'FINALIZED';
const parseFields = q => q?.fields ? String(q.fields).split(',').map(f => f.trim()).filter(Boolean) : null;
const applyFields = (obj, fields) => { if (!fields?.length) return obj; const o={}; fields.forEach(f=>{if(f in obj)o[f]=obj[f];}); return o; };
const parseMeta = raw => { if (!raw) return null; try { return JSON.parse(raw); } catch(_){ return raw; } };
const normaliseTotal = raw => { if (raw == null) return null; const p = parseInt(String(raw),10); return isNaN(p) ? null : p; };

function normaliseOpinion(item) {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  ['id','text','ai_response','verdict','status','author','source','metadata'].forEach(k => {
    if (k in out && out[k] != null && typeof out[k] !== 'string') out[k] = JSON.stringify(out[k]);
  });
  return out;
}

function parseQueryStr(url) {
  try { const u = new URL('http://x'+url); const q={}; u.searchParams.forEach((v,k)=>{q[k]=v;}); return q; }
  catch(_){ return {}; }
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleRequest(method, path, body, headers, query) {
  body = body || {}; query = query || {}; headers = headers || {};
  const pk = headers['x-private-key'] || headers['X-Private-Key'];

  if (method === 'GET' && path === '/') return {
    name: 'EngageChain API', version: '2.0.0', contract: CONTRACT_ADDRESS,
    rpc: CUSTOM_RPC || `https://${RPC_HOST}:${RPC_PORT}${RPC_PATH}`,
    repo: 'https://github.com/Said1235/Engagechain-api',
    docs: 'https://engagechaindocs.netlify.app',
    endpoints: {
      'GET  /':                               'API info',
      'GET  /health':                         'Health check',
      'GET  /opinions':                       'List  ?status= ?source= ?limit= ?offset= ?fields=',
      'GET  /opinions/count':                 'Total count',
      'GET  /opinions/:id':                   'Full opinion  ?fields= ?parse_ai= ?parse_metadata=',
      'GET  /opinions/:id/status':            'Status only',
      'POST /opinions':                       'Submit  { text, metadata?, wait? }',
      'POST /opinions/:id/evaluate':          'GenLayer AI  { wait? }',
      'POST /opinions/:id/evaluate/external': 'External AI  { analysis, wait? }',
      'POST /opinions/:id/finalize':          'Finalize  { verdict, wait? }',
      'POST /rpc':                            'Raw JSON-RPC proxy',
    },
  };

  if (method === 'GET' && path === '/health') return { status: 'ok', contract: CONTRACT_ADDRESS };
  if (method === 'POST' && path === '/rpc') return rpcJSON(body);

  if (method === 'GET' && path === '/opinions') {
    const raw = await genCall('get_all_opinions', []);
    const all = Object.keys(raw || {});
    const limit  = Math.min(Math.max(parseInt(query.limit  || '100', 10), 1), 500);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);
    const fields = parseFields(query);
    if (query.status || query.source || fields) {
      const items = await Promise.all(all.map(id => genCall('get_resolution_data',[id]).then(normaliseOpinion).catch(()=>null)));
      let filtered = items.filter(i => i && (!query.status||i.status===query.status) && (!query.source||i.source===query.source));
      const tf = filtered.length;
      const results = filtered.slice(offset, offset+limit).map(i=>applyFields(i,fields));
      return { total: all.length, total_filtered: tf, limit, offset, count: results.length, opinions: results };
    }
    const paged = all.slice(offset, offset+limit);
    const opinions = {};
    paged.forEach(id => { opinions[id] = raw[id]; });
    return { total: all.length, limit, offset, count: paged.length, opinions };
  }

  if (method === 'GET' && path === '/opinions/count') {
    return { total: normaliseTotal(await genCall('get_total_submissions', [])) };
  }

  const mId = path.match(/^\/opinions\/([^/]+)$/);
  if (mId && method === 'GET') {
    const fields = parseFields(query);
    let item = normaliseOpinion(await genCall('get_resolution_data', [mId[1]]));
    if (query.parse_ai === 'true' && item?.ai_response)
      try { item = { ...item, ai_response: JSON.parse(item.ai_response) }; } catch(_){}
    if (query.parse_metadata === 'true' && item?.metadata)
      item = { ...item, metadata: parseMeta(item.metadata) };
    return applyFields(item, fields);
  }

  const mSt = path.match(/^\/opinions\/([^/]+)\/status$/);
  if (mSt && method === 'GET') return { id: mSt[1], status: String(await genCall('get_status', [mSt[1]])) };

  if (method === 'POST' && path === '/opinions') {
    const { text, metadata, wait } = body;
    if (!text?.trim()) throw new Error('body.text is required (non-empty string)');
    if (text.length > 2000) throw new Error('body.text cannot exceed 2000 characters');
    let meta = '';
    if (metadata != null) { meta = typeof metadata === 'string' ? metadata : JSON.stringify(metadata); }
    const w = parseWait(body, headers);
    const out = await genWrite('submit_opinion', [text, meta], pk, w);
    return { opinion_id: String(out.result), txHash: out.txHash, status: 'pending', metadata: meta ? parseMeta(meta) : null, wait: w };
  }

  const mEv = path.match(/^\/opinions\/([^/]+)\/evaluate$/);
  if (mEv && method === 'POST') {
    const w = parseWait(body, headers);
    const out = await genWrite('evaluate_opinion', [mEv[1]], pk, w);
    let ai = out.result;
    if (typeof ai === 'string') try { ai = JSON.parse(ai); } catch(_){}
    return { opinion_id: mEv[1], txHash: out.txHash, status: 'evaluated', ai_response: ai, wait: w };
  }

  const mEx = path.match(/^\/opinions\/([^/]+)\/evaluate\/external$/);
  if (mEx && method === 'POST') {
    if (!body.analysis) throw new Error('body.analysis is required');
    const aStr = typeof body.analysis === 'string' ? body.analysis : JSON.stringify(body.analysis);
    if (aStr.length > 10000) throw new Error('body.analysis cannot exceed 10000 characters');
    const w = parseWait(body, headers);
    const out = await genWrite('submit_with_external_ai', [mEx[1], aStr], pk, w);
    return { opinion_id: mEx[1], txHash: out.txHash, status: 'evaluated', source: 'external', ai_response: parseMeta(aStr), wait: w };
  }

  const mFi = path.match(/^\/opinions\/([^/]+)\/finalize$/);
  if (mFi && method === 'POST') {
    if (!body.verdict?.trim()) throw new Error('body.verdict is required (non-empty string)');
    const w = parseWait(body, headers);
    const out = await genWrite('finalize_opinion', [mFi[1], body.verdict], pk, w);
    return { opinion_id: mFi[1], txHash: out.txHash, status: 'finalized', verdict: body.verdict, wait: w };
  }

  const err = new Error('Not found: ' + method + ' ' + path);
  err.status = 404;
  throw err;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Private-Key, X-Wait-Status',
};

function sendOk(res, data)  { res.status(200).json(Object.assign({ ok: true }, data)); }
function sendErr(res, err)  { console.error('[api]', err.message); res.status(err.status||500).json({ ok: false, error: err.message }); }

// ── Vercel export ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  const path  = (req.url || '/').replace(/^\/api/, '').split('?')[0] || '/';
  const query = parseQueryStr(req.url || '/');
  try { sendOk(res, await handleRequest(req.method, path, req.body, req.headers, query)); }
  catch (err) { sendErr(res, err); }
};

// ── Express router export (Railway / Heroku / VPS) ────────────────────────────
try {
  const express = require('express');
  const router  = express.Router();
  router.use((req, res, next) => { Object.entries(CORS).forEach(([k,v])=>res.setHeader(k,v)); if(req.method==='OPTIONS') return res.status(200).end(); next(); });
  router.all('*', async (req, res) => {
    try { sendOk(res, await handleRequest(req.method, req.path, req.body, req.headers, req.query)); }
    catch (err) { sendErr(res, err); }
  });
  module.exports.router = router;
} catch (_) { /* express not installed — Vercel-only mode */ }
