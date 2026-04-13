/**
 * EngageChain API — Express server
 * Railway, Heroku, or any VPS / bare Node.js host.
 * For Vercel, api/index.js is the serverless function entry.
 *
 * Start: node server.js
 */

const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Mount the API router
const { router } = require('./api/index.js');
app.use('/', router);

app.listen(PORT, () => {
  console.log(`\n◈ EngageChain API  http://localhost:${PORT}`);
  console.log(`  Contract : ${process.env.CONTRACT_ADDRESS || '(set CONTRACT_ADDRESS)'}`);
  console.log(`  RPC      : ${process.env.GENLAYER_RPC    || 'https://studio.genlayer.com:8443/api'}`);
  console.log(`  Docs     : GET /\n`);
});
