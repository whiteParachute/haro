#!/usr/bin/env node
'use strict';
const { runCli } = require('../dist/index.js');
runCli()
  .then((result) => {
    process.exitCode = result.exitCode;
  })
  .catch((err) => {
    const message = err && err.message ? err.message : String(err);
    process.stderr.write(`${message}
`);
    process.exitCode = 1;
  });
