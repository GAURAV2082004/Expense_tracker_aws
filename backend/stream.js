// Triggered by the DynamoDB stream of the Expenses table. Keeps one "SUMMARY#YYYY-MM" item per
// month up to date, so the API never re-reads every transaction to build a summary.
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const db = require("./db");

const TRANSACTION_SK = /^\d{4}-\d{2}-\d{2}#/;
const isTransaction = (item) => item !== null && TRANSACTION_SK.test(item.sk);

exports.handler = async (event) => {
  for (const record of event.Records) {
    const before = record.dynamodb.OldImage ? unmarshall(record.dynamodb.OldImage) : null;
    const after = record.dynamodb.NewImage ? unmarshall(record.dynamodb.NewImage) : null;

    // Summaries, budgets and dedupe markers also appear in the stream. Only transactions count.
    // Ignoring our own summary writes is what prevents an infinite loop.
    //
    // INSERT: add the new item. REMOVE: subtract the old one. MODIFY: subtract old, add new.
    // The dedupe key is unique per stream record and direction, so a retry changes nothing.
    if (isTransaction(before)) await db.applyDelta(before, -1, `${record.eventID}-`);
    if (isTransaction(after)) await db.applyDelta(after, 1, `${record.eventID}+`);
  }
  // Throwing makes Lambda retry the batch. After MaximumRetryAttempts the batch goes to the DLQ.
};
