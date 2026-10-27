import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const required = ['MYSQL_TEST_HOST', 'MYSQL_TEST_PORT', 'MYSQL_TEST_USER', 'MYSQL_TEST_PASSWORD'];
assert(
  required.every(name => process.env[name]),
  'Set explicit MYSQL_TEST_* variables for a disposable database'
);
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'mysql-mcp-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...options });
}
try {
  const suppliedDirectory = process.env.MYSQL_TEST_TARBALL_DIR;
  if (!suppliedDirectory) run(npm, ['pack', '--pack-destination', scratch]);
  const artifactDirectory = suppliedDirectory || scratch;
  const tarballs = readdirSync(artifactDirectory).filter(name => name.endsWith('.tgz'));
  assert.equal(tarballs.length, 1, 'Expected exactly one reviewable tarball');
  const tarball = join(artifactDirectory, tarballs[0]);
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'mysql-mcp-package-test', private: true }));
  run(npm, [
    'install',
    '--prefix',
    scratch,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    tarball
  ]);
  const installed = join(scratch, 'node_modules/@hechtcarmel/mysql-mcp-server');
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.bin['mysql-mcp-server'], 'dist/index.js');
  assert.equal(manifest.scripts.prepare, undefined, 'Tarball installation must not need a build or pnpm');
  for (const file of [
    'dist/index.js',
    '.env.example',
    'AGENTS.md',
    'SECURITY.md',
    'docs/architecture.md',
    'scripts/local-smoke.mjs',
    'scripts/smoke-transport.mjs'
  ]) {
    assert(existsSync(join(installed, file)), `Missing package file: ${file}`);
  }
  for (const file of ['.env', 'tests', 'src', '.github', 'node_modules']) {
    assert(!existsSync(join(installed, file)), `Unexpected package content: ${file}`);
  }
  run(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--project', 'integration'], {
    env: { ...process.env, MYSQL_TEST_SERVER_ENTRY: join(installed, manifest.bin['mysql-mcp-server']) }
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
