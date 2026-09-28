const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { uploadsDir, bundledUploadsDir } = require('../src/config/uploads');

function listFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relative)
      : [relative];
  });
}

test('bundled legacy upload URLs are served through both upload routes', async (t) => {
  const app = express();
  app.use(
    ['/uploads', '/api/uploads'],
    express.static(uploadsDir),
    express.static(bundledUploadsDir)
  );

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const port = server.address().port;
  const files = listFiles(bundledUploadsDir);
  assert.equal(files.length, 39);

  for (const file of files) {
    for (const route of ['/uploads', '/api/uploads']) {
      const response = await fetch(`http://127.0.0.1:${port}${route}/${file}`);
      assert.equal(response.status, 200, `${route}/${file}`);
      assert.ok(Number(response.headers.get('content-length')) > 0, `${route}/${file}`);
    }
  }
});
