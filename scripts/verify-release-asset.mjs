import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const files = readdirSync('.').filter(name => name.endsWith('.tgz'));
assert.equal(files.length, 1, 'Expected exactly one release tarball');
const manifest = JSON.parse(execFileSync('tar', ['-xOf', files[0], 'package/package.json'], { encoding: 'utf8' }));
assert.equal(manifest.name, '@hechtcarmel/mysql-mcp-server');
assert.equal(`v${manifest.version}`, process.env.RELEASE_TAG, 'Release tarball version does not match the tag');
console.log(`Verified ${manifest.name}@${manifest.version}`);
