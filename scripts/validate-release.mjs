import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const tag = process.env.RELEASE_TAG;
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert(tag && /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag), 'Use an existing vX.Y.Z or prerelease tag');
assert.equal(tag, `v${manifest.version}`, 'Release tag and package.json version must match');
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
assert(
  changelog.split('\n').some(line => line.startsWith(`## [${manifest.version}] - `)),
  'Add a dated changelog entry for this version'
);
console.log(`Validated ${tag}`);
