'use strict';
// Loaded before the test runner starts (see "test" in package.json).
// On macOS the temporary folder is /var/folders/…, and /var is a link to /private/var. Paddock's
// local-library safety check refuses any folder that is reached through a link, so every test that
// puts a library in the temporary folder failed there. Point the tests at the folder's real path
// instead; the test files started by the runner inherit it. Windows uses TEMP/TMP and needs nothing.
const fs = require('node:fs'),
  os = require('node:os');
if (process.platform !== 'win32') {
  try {
    const real = fs.realpathSync(os.tmpdir());
    if (real !== os.tmpdir()) process.env.TMPDIR = real;
  } catch {
    // Leave the temporary folder as it is; the tests then report the real problem.
  }
}
