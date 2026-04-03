# ◈ EngageChain API

A REST API wrapper around the **EngageChain** GenLayer Intelligent Contract.  
Deploy once — any frontend, any language can consume it.

---

## Deploy

### Vercel (recommended — zero config)
```bash
npm install -g vercel
vercel env add CONTRACT_ADDRESS   # paste your contract address
vercel --prod
```

### Railway
```bash
# Push to GitHub, then connect repo on railway.app
# Set env vars in Railway dashboard:
#   CONTRACT_ADDRESS, GENLAYER_RPC (optional), PRIVATE_KEY (optional)
railway up
```

### Heroku
```bash
heroku create my-engagechain-api
heroku config:set CONTRACT_ADDRESS=0x99e24b7246DeD27634bBD8659b4D9915ac700EdD
git push heroku main
```

### Local
```bash
npm install
cp .env.example .env      # fill in CONTRACT_ADDRESS
node server.js            # → http://localhost:3000
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CONTRACT_ADDRESS` | **Yes** | — | Deployed EngageChain contract address |
| `GENLAYER_RPC` | No | studionet | GenLayer RPC endpoint |
| `PRIVATE_KEY` | No | auto-generated | Default signing key for write ops |
| `PORT` | No | 3000 | HTTP port (set automatically by Railway/Heroku) |

---

## Authentication for Write Endpoints

Write endpoints (`POST`) require a wallet to sign the transaction.  
Pass the private key as a request header:

```
X-Private-Key: 0xyour_private_key_here
```

If `X-Private-Key` is omitted and `PRIVATE_KEY` env var is set, the server key is used.  
If neither is present, a **fresh studionet key is auto-generated** (only works on studionet — the account is auto-funded).

---

## Endpoints

### `GET /`
Returns API info and endpoint list.

```bash
curl https://your-api.vercel.app/
```

---

### `GET /health`
Health check.

```json
{ "ok": true, "status": "ok", "contract": "0x99e2...", "rpc": "https://..." }
```

---

### `GET /opinions`
Returns all submitted opinions as `{ id: text }`.

```bash
curl https://your-api.vercel.app/opinions
```

```json
{
  "ok": true,
  "0": "GenLayer is the future of AI on-chain",
  "1": "Cats are better than dogs"
}
```

---

### `GET /opinions/count`
Returns the total number of opinions submitted.

```bash
curl https://your-api.vercel.app/opinions/count
```

```json
{ "ok": true, "total": "5" }
```

---

### `GET /opinions/:id`
Returns full data for one opinion.

```bash
curl https://your-api.vercel.app/opinions/0
```

```json
{
  "ok": true,
  "id": "0",
  "text": "GenLayer is the future of AI on-chain",
  "status": "finalized",
  "author": "0xabc...",
  "source": "genlayer",
  "ai_response": "{\"summary\":\"...\",\"sentiment\":\"positive\",...}",
  "verdict": "Valid and well-argued proposal"
}
```

---

### `GET /opinions/:id/status`
Returns just the status of one opinion.

```bash
curl https://your-api.vercel.app/opinions/0/status
```

```json
{ "ok": true, "id": "0", "status": "finalized" }
```

---

### `POST /opinions`
Submits a new opinion on-chain. Returns the new opinion ID.

```bash
curl -X POST https://your-api.vercel.app/opinions \
  -H "Content-Type: application/json" \
  -H "X-Private-Key: 0xyourkey" \
  -d '{ "text": "My opinion about something" }'
```

```json
{
  "ok": true,
  "opinion_id": "5",
  "txHash": "0xabc...",
  "status": "pending"
}
```

**Body:**
```json
{ "text": "string (1–2000 chars, required)" }
```

---

### `POST /opinions/:id/evaluate`
Triggers GenLayer AI evaluation. Validators run the LLM and reach consensus.  
This takes **30–120 seconds** — the request will wait until FINALIZED.

```bash
curl -X POST https://your-api.vercel.app/opinions/5/evaluate \
  -H "X-Private-Key: 0xyourkey"
```

```json
{
  "ok": true,
  "opinion_id": "5",
  "txHash": "0xabc...",
  "status": "evaluated",
  "ai_response": {
    "summary": "...",
    "sentiment": "positive",
    "category": "proposal",
    "key_points": ["...", "..."],
    "ai_recommendation": "...",
    "confidence_score": "0.87"
  }
}
```

---

### `POST /opinions/:id/evaluate/external`
Validates the opinion with your own AI analysis instead of GenLayer's LLM.  
GenLayer validators verify the JSON is well-formed and store it on-chain.

```bash
curl -X POST https://your-api.vercel.app/opinions/5/evaluate/external \
  -H "Content-Type: application/json" \
  -H "X-Private-Key: 0xyourkey" \
  -d '{
    "analysis": {
      "summary": "This proposal is innovative and well-structured.",
      "sentiment": "positive",
      "category": "proposal",
      "key_points": ["Novel approach", "Technically feasible"],
      "ai_recommendation": "Approve",
      "confidence_score": "0.92"
    }
  }'
```

```json
{
  "ok": true,
  "opinion_id": "5",
  "txHash": "0xabc...",
  "status": "evaluated",
  "source": "external"
}
```

**Body:**
```json
{
  "analysis": {
    "summary": "string",
    "sentiment": "positive|negative|neutral|mixed",
    "category": "proposal|opinion|dispute|question|other",
    "key_points": ["string", "..."],
    "ai_recommendation": "string",
    "confidence_score": "0.0–1.0 as string"
  }
}
```

---

### `POST /opinions/:id/finalize`
Records the final verdict on-chain. Must be called after evaluate.

```bash
curl -X POST https://your-api.vercel.app/opinions/5/finalize \
  -H "Content-Type: application/json" \
  -H "X-Private-Key: 0xyourkey" \
  -d '{ "verdict": "Approved by consensus" }'
```

```json
{
  "ok": true,
  "opinion_id": "5",
  "txHash": "0xabc...",
  "status": "finalized",
  "verdict": "Approved by consensus"
}
```

---

### `POST /rpc`
Raw JSON-RPC proxy — forwards any request directly to the GenLayer node.  
Use this to call any contract method not exposed by the REST API.

```bash
curl -X POST https://your-api.vercel.app/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "gen_call",
    "params": [{
      "from": "0x0000000000000000000000000000000000000000",
      "to": "0x99e24b7246DeD27634bBD8659b4D9915ac700EdD",
      "type": "read",
      "data": { "function": "get_all_opinions", "args": [] },
      "status": "accepted"
    }]
  }'
```

---

## Node.js Usage Examples

### Install (no SDK needed — just fetch)
```bash
npm install  # only express + cors needed for the server itself
```

### Read opinions (no auth needed)
```javascript
const BASE = 'https://your-api.vercel.app';

// Get all opinions
const all = await fetch(`${BASE}/opinions`).then(r => r.json());
console.log(all); // { ok: true, "0": "text...", "1": "text..." }

// Get one opinion
const op = await fetch(`${BASE}/opinions/0`).then(r => r.json());
console.log(op.status, op.ai_response);

// Get count
const { total } = await fetch(`${BASE}/opinions/count`).then(r => r.json());
console.log('Total:', total);
```

### Full workflow (with private key)
```javascript
const BASE = 'https://your-api.vercel.app';
const KEY  = '0xyour_private_key';
const post = (path, body) => fetch(`${BASE}${path}`, {
  method:  'POST',
  headers: { 'Content-Type': 'application/json', 'X-Private-Key': KEY },
  body:    JSON.stringify(body),
}).then(r => r.json());

// 1. Submit
const { opinion_id } = await post('/opinions', { text: 'My opinion here' });
console.log('Submitted ID:', opinion_id);

// 2. Evaluate with GenLayer AI (~30-120s)
const evalResult = await post(`/opinions/${opinion_id}/evaluate`);
console.log('AI result:', evalResult.ai_response);

// 3. Finalize
const final = await post(`/opinions/${opinion_id}/finalize`, {
  verdict: evalResult.ai_response?.ai_recommendation || 'Verified',
});
console.log('Finalized:', final.status);

// 4. Read back
const data = await fetch(`${BASE}/opinions/${opinion_id}`).then(r => r.json());
console.log(data);
```

### Use your own AI instead of GenLayer
```javascript
// After submitting, validate with your own AI output
const myAnalysis = {
  summary:           'This opinion proposes a new governance model.',
  sentiment:         'positive',
  category:          'proposal',
  key_points:        ['Decentralized', 'Transparent', 'Scalable'],
  ai_recommendation: 'Approve — well structured and feasible',
  confidence_score:  '0.91',
};

const result = await post(`/opinions/${opinion_id}/evaluate/external`, {
  analysis: myAnalysis,
});
console.log('Stored on-chain via external AI:', result.status);
```

---

## Error Responses

All errors return:
```json
{ "ok": false, "error": "human-readable error message" }
```

| HTTP | When |
|---|---|
| 400 | Bad request (missing required field, validation failed) |
| 404 | Unknown route |
| 500 | Contract error, RPC error, network error |

---

## Contract

The contract is deployed on GenLayer studionet.  
Source: `contract/engagechain.py`  
Address: set via `CONTRACT_ADDRESS` env var.

The API is a stateless wrapper — it holds no data itself.  
All state lives on-chain in the GenLayer contract.
