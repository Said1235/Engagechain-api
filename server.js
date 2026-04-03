/**
 * EngageChain API — Express server
 * Use this for Railway, Heroku, or any Node.js host.
 * For Vercel, the /api/*.js files are used directly as serverless functions.
 *
 * Start: node server.js
 * Env:   PORT (default 3000), GENLAYER_RPC (default studionet)
 */

const express = require('express');
const cors    = require('cors');
const { router } = require('./api/index.js');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/', router);

app.listen(PORT, () => {
  console.log(`EngageChain API running on http://localhost:${PORT}`);
  console.log(`GenLayer RPC: ${process.env.GENLAYER_RPC || 'https://studio.genlayer.com:8443/api'}`);
  console.log(`Contract:     ${process.env.CONTRACT_ADDRESS || '(set CONTRACT_ADDRESS env var)'}`);
});
