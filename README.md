# ◈ EngageChain API v2

REST API wrapper for the **EngageChain** GenLayer Intelligent Contract.
Deploy once — any frontend or service can consume it.

---

## Deploy

### Vercel
```bash
npm install -g vercel
vercel env add CONTRACT_ADDRESS
vercel --prod
```

### Railway
Push to GitHub, connect repo on railway.app, set env vars in dashboard.

### Heroku
```bash
heroku create my-engagechain-api
heroku config:set CONTRACT_ADDRESS=0x...
git push heroku main
```

### Local
```bash
npm install
cp .env.example .env    # set CONTRACT_ADDRESS
node server.js          # → http://localhost:3000
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CONTRACT_ADDRESS` | **Yes** | — | Deployed EngageChain contract address |
| `GENLAYER_RPC` | No | studionet | GenLayer RPC endpoint |
| `PRIVATE_KEY` | No | auto-generated | Default signing key for write ops |
| `PORT` | No | 3000 | Port for server.js |

---

## Auth for Write Endpoints

```
X-Private-Key: 0xyour_private_key_here
```
Or set `PRIVATE_KEY` env var as server-wide default.
If neither is set, a fresh studionet key is auto-generated.

---

## All Custom Parameters

### GET /opinions

| Param | Values | Description |
|---|---|---|
| `?status=` | `pending`, `evaluated`, `finalized` | Filter by status |
| `?source=` | `genlayer`, `external` | Filter by AI source |
| `?limit=N` | 1–500 | Max results (default 100) |
| `?offset=N` | 0+ | Skip N results for pagination |
| `?fields=` | comma-separated field names | Return only these fields |

### GET /opinions/:id

| Param | Values | Description |
|---|---|---|
| `?fields=` | comma-separated | Only return these fields |
| `?parse_ai=true` | `true` | Parse `ai_response` string → JSON object |
| `?parse_metadata=true` | `true` | Parse `metadata` string → JSON object |

### POST /opinions — body

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | Yes | Opinion text (1–2000 chars) |
| `metadata` | object or string | No | Custom data stored on-chain with the opinion |
| `wait` | `"accepted"` or `"finalized"` | No | How long to wait (default: `"finalized"`) |

### POST /opinions/:id/evaluate — body

| Field | Type | Description |
|---|---|---|
| `wait` | `"accepted"` or `"finalized"` | Wait status (default: `"finalized"`) |

### POST /opinions/:id/evaluate/external — body

| Field | Type | Required | Description |
|---|---|---|---|
| `analysis` | object or string | Yes | Your AI analysis |
| `wait` | `"accepted"` or `"finalized"` | No | Wait status |

### POST /opinions/:id/finalize — body

| Field | Type | Required | Description |
|---|---|---|---|
| `verdict` | string | Yes | Final verdict recorded on-chain |
| `wait` | `"accepted"` or `"finalized"` | No | Wait status |

### All write endpoints — headers

| Header | Description |
|---|---|
| `X-Private-Key` | Wallet private key for signing |
| `X-Wait-Status` | Alternative to `body.wait` |

---

## Endpoint Reference

### GET /opinions — filter + paginate

```bash
# All pending opinions, page 1
curl "https://your-api.vercel.app/opinions?status=pending&limit=10&offset=0"

# Only specific fields
curl "https://your-api.vercel.app/opinions?status=finalized&fields=id,text,verdict"
```

```json
{
  "ok": true,
  "total": 12,
  "total_filtered": 3,
  "limit": 10,
  "offset": 0,
  "count": 3,
  "opinions": [
    { "id": "2", "text": "...", "verdict": "Approved" }
  ]
}
```

### GET /opinions/:id — with parsed fields

```bash
curl "https://your-api.vercel.app/opinions/0?parse_ai=true&parse_metadata=true"
```
```json
{
  "ok": true,
  "id": "0",
  "text": "GenLayer is the future",
  "ai_response": { "summary": "...", "sentiment": "positive", "confidence_score": "0.87" },
  "metadata": { "topic": "blockchain", "tags": ["AI"] }
}
```

### POST /opinions — with metadata

```bash
curl -X POST https://your-api.vercel.app/opinions \
  -H "Content-Type: application/json" \
  -H "X-Private-Key: 0xyourkey" \
  -d '{
    "text": "My proposal for decentralized governance",
    "metadata": {
      "app": "my-dapp",
      "tags": ["governance", "web3"],
      "author_display": "alice.eth",
      "custom_field": "any value"
    },
    "wait": "accepted"
  }'
```
```json
{
  "ok": true,
  "opinion_id": "5",
  "txHash": "0xabc...",
  "status": "pending",
  "metadata": { "app": "my-dapp", "tags": ["governance", "web3"] },
  "wait": "ACCEPTED"
}
```

---

## Node.js Examples

```javascript
const BASE = 'https://your-api.vercel.app';
const KEY  = '0xyour_private_key';

const get  = url => fetch(`${BASE}${url}`).then(r => r.json());
const post = (url, body) => fetch(`${BASE}${url}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Private-Key': KEY },
  body: JSON.stringify(body),
}).then(r => r.json());

// ── Read with custom params ───────────────────────────────────────────────
const pending  = await get('/opinions?status=pending&limit=5');
const detail   = await get('/opinions/0?parse_ai=true&parse_metadata=true&fields=id,text,ai_response,metadata');
const idStatus = await get('/opinions/0?fields=id,status');

// ── Full workflow with metadata ───────────────────────────────────────────
const { opinion_id } = await post('/opinions', {
  text:     'My proposal for decentralized governance',
  metadata: { app: 'my-dapp', tags: ['governance', 'web3'], version: '1.0' },
});

const { ai_response } = await post(`/opinions/${opinion_id}/evaluate`);

await post(`/opinions/${opinion_id}/finalize`, {
  verdict: ai_response.ai_recommendation,
});

// ── Pagination ────────────────────────────────────────────────────────────
async function getAll(filter = {}) {
  const qs = new URLSearchParams({ limit: '20', ...filter }).toString();
  const results = [];
  let offset = 0;
  while (true) {
    const page = await get(`/opinions?${qs}&offset=${offset}`);
    const items = Array.isArray(page.opinions) ? page.opinions : Object.values(page.opinions || {});
    results.push(...items);
    const total = page.total_filtered ?? page.total ?? 0;
    if (results.length >= total || items.length === 0) break;
    offset += 20;
  }
  return results;
}

const allFinalized = await getAll({ status: 'finalized' });
```

---

## Error Format

```json
{ "ok": false, "error": "human-readable message" }
```

---

## Contract Changes in v2

Added `metadata: TreeMap[str, str]` field.
`submit_opinion(text, metadata="")` — second param is optional, default `""`.
Fully backward compatible — existing submissions without metadata still work.
