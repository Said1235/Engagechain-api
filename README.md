# ◈ EngageChain API

> **AI-Native Opinion Protocol — deployable REST API on Vercel**

EngageChain is an **Intelligent Contract** on [GenLayer](https://genlayer.com) that lets any app submit opinions or proposals, have them evaluated by an AI with multi-validator consensus, and store the result permanently on-chain.

This repo exposes that contract as a clean, deployable REST API — no frontend, no dependencies, just two HTTP endpoints ready to plug into any application.

---

## What It Does

```
Your app → POST /api/contract → GenLayer studionet → AI validators → on-chain result
```

1. **Submit** an opinion or proposal (any text up to 2000 chars)
2. **Evaluate** — the contract sends it to an LLM; multiple validators reach consensus via Optimistic Democracy
3. **Finalize** — the verdict is stored permanently on-chain with a unique ID
4. **Read** — anyone can query any opinion, its AI analysis, status, and verdict at any time

---

## Deploy in 30 seconds

```bash
git clone https://github.com/Said1235/Engagechain.git
cd Engagechain
vercel deploy
```

No environment variables. No configuration. Done.

> Requires [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`

---

## Endpoints

### `POST /api/contract`
The main endpoint. Send a JSON body with `method` and `args`.

### `POST /api/rpc`
Raw JSON-RPC proxy to GenLayer studionet — for advanced use cases where you want full protocol-level control.

---

## Usage

### Read Methods — no key required

#### Get total number of submitted opinions
```bash
curl -X POST https://your-app.vercel.app/api/contract \
  -H "Content-Type: application/json" \
  -d '{"method":"get_total_submissions","args":[]}'
```
```json
{ "ok": true, "result": "7" }
```

---

#### Get all submitted opinions
```bash
curl -X POST https://your-app.vercel.app/api/contract \
  -H "Content-Type: application/json" \
  -d '{"method":"get_all_opinions","args":[]}'
```
```json
{ "ok": true, "result": { "0": "The internet should be free", "1": "AI needs regulation" } }
```

---

#### Get full data for a specific opinion
```bash
curl -X POST https://your-app.vercel.app/api/contract \
  -H "Content-Type: application/json" \
  -d '{"method":"get_resolution_data","args":["0"]}'
```
```json
{
  "ok": true,
  "result": {
    "id": "0",
    "text": "The internet should be free",
    "status": "evaluated",
    "author": "0xabc123...",
    "ai_response": "{\"summary\":\"...\",\"sentiment\":\"positive\",\"confidence_score\":\"0.91\",...}",
    "verdict": ""
  }
}
```

---

#### Get the status of an opinion
```bash
curl -X POST https://your-app.vercel.app/api/contract \
  -H "Content-Type: application/json" \
  -d '{"method":"get_status","args":["0"]}'
```
```json
{ "ok": true, "result": "evaluated" }
```

Possible statuses: `pending` → `evaluated` → `finalized`

---

### Write Methods — require `privateKey`

> Get a free studionet private key at [studio.genlayer.com](https://studio.genlayer.com) — accounts are auto-funded on testnet.

#### Submit an opinion
```bash
curl -X POST https://your-app.vercel.app/api/contract \
  -H "Content-Type: application/json" \
  -d '{
    "method": "submit_opinion",
    "args": ["AI should be open source"],
    "privateKey": "0x..."
  }'
```
```json
{ "ok": true, "txHash": "0xabc...", "result": "7" }
```
`result` is the opinion ID assigned on-chain.

---

#### Evaluate with AI (triggers LLM + validator consensus)
```bash
curl -X POST https://your-app.vercel.app/api/contract \
  -H "Content-Type: application/json" \
  -d '{
    "method": "evaluate_opinion",
    "args": ["7"],
    "privateKey": "0x..."
  }'
```
```json
{
  "ok": true,
  "txHash": "0xdef...",
  "result": {
    "summary": "The author argues AI models should be open source for societal benefit.",
    "sentiment": "positive",
    "category": "proposal",
    "key_points": ["Transparency", "Democratization", "Safety concerns"],
    "ai_recommendation": "Strong proposal with valid arguments. Recommend further community debate.",
    "confidence_score": "0.88"
  }
}
```

> ⏱ This call takes 30–120 seconds — AI validators need time to reach consensus.

---

#### Finalize an opinion with a verdict
```bash
curl -X POST https://your-app.vercel.app/api/contract \
  -H "Content-Type: application/json" \
  -d '{
    "method": "finalize_opinion",
    "args": ["7", "Approved by GenLayer consensus"],
    "privateKey": "0x..."
  }'
```
```json
{ "ok": true, "txHash": "0xghi...", "result": { "id": "7", "status": "finalized" } }
```

---

## Response Format

All responses from `/api/contract`:

```json
{ "ok": true,  "result": <any> }
{ "ok": false, "error": "error message" }
```

All responses from `/api/rpc` follow the GenLayer JSON-RPC spec:

```json
{ "jsonrpc": "2.0", "id": 1, "result": <any> }
{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32603, "message": "..." } }
```

---

## Contract Reference

| Method | Type | Arguments | Returns |
|---|---|---|---|
| `get_total_submissions` | read | — | `"7"` |
| `get_all_opinions` | read | — | `{ "0": "text", ... }` |
| `get_resolution_data` | read | `opinion_id: str` | full opinion object |
| `get_status` | read | `opinion_id: str` | `"pending"` / `"evaluated"` / `"finalized"` |
| `submit_opinion` | write | `text: str` | opinion ID |
| `evaluate_opinion` | write | `opinion_id: str` | AI analysis object |
| `finalize_opinion` | write | `opinion_id: str`, `verdict: str` | `{ id, status }` |

**Contract address:** `0x102625d1C7329faD69057744B38e2C924afd3dB4`  
**Network:** GenLayer Studionet  
**View in Studio:** [studio.genlayer.com](https://studio.genlayer.com/?import-contract=0x102625d1C7329faD69057744B38e2C924afd3dB4)

---

## How the AI Evaluation Works

When `evaluate_opinion` is called, the contract executes this flow entirely on-chain:

```python
def get_analysis() -> str:
    raw = gl.nondet.exec_prompt(task)            # LLM call inside non-deterministic block
    parsed = json.loads(raw)
    return json.dumps(parsed, sort_keys=True)    # deterministic string for consensus

result_str  = gl.eq_principle.strict_eq(get_analysis)  # validators compare byte-for-byte
result_json = json.loads(result_str)                    # deserialize outside nondet block
```

Multiple validators independently run the same prompt. `strict_eq` confirms they all got equivalent results before the transaction is accepted. No single party controls the AI output.

---

## Stack

| | |
|---|---|
| Smart Contract | Python · GenLayer SDK (`py-genlayer:test`) |
| Network | GenLayer Studionet |
| API Runtime | Node.js 24 · Vercel Serverless Functions |
| RPC Transport | Node `https` built-in · dual-port retry (443 → 8443) |

---

## Files

```
api/
  rpc.js           Raw JSON-RPC proxy to studionet
  contract.js      Simplified REST wrapper
contract/
  engagechain.py   GenLayer Intelligent Contract (Python)
vercel.json        Vercel config (maxDuration: 60s for AI calls)
package.json       Node 24.x engine pin
README.md          This file
```

---

## License

MIT — Built on [GenLayer](https://genlayer.com) · by [@Said1235](https://github.com/Said1235)
