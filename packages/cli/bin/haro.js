#!/usr/bin/env node
'use strict';
const { runCli } = require('../dist/index.js');

function flushStream(stream) {
  return new Promise((resolve) => {
    if (!stream || typeof stream.write !== 'function') {
      resolve();
      return;
    }
    if (stream.writableNeedDrain) {
      stream.once('drain', resolve);
      return;
    }
    setImmediate(resolve);
  });
}

async function main() {
  try {
    const result = await runCli();
    await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);
    process.exitCode = result.exitCode;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    await flushStream(process.stderr);
    process.exitCode = 1;
  }
}

main();
