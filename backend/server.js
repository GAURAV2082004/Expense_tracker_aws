// Local development only. Lambda uses lambda.js (API) and stream.js (DynamoDB Streams).
process.env.LOG_REQUESTS ??= "true";

const express = require("express");
const cors = require("cors");

const port = process.env.PORT || 3001;

// CORS must come before the routes. In AWS, the HTTP API handles CORS instead.
const server = express();
server.use(cors({ origin: "http://localhost:5173" }));
server.use(require("./app"));

server.listen(port, () => {
  const mode = process.env.TABLE_NAME
    ? `DynamoDB table ${process.env.TABLE_NAME}`
    : "in-memory store (summaries are updated inline, there is no stream locally)";
  console.log(`API on http://localhost:${port} (${mode})`);
});
