// Run only on the user's Mac with an isolated preview installation.
// Fixed read-only workload: no mutation SQL, rejection probes, mocks, or aggregate suites.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join, isAbsolute } from 'node:path';

const directory = process.env.MYSQL_MCP_PREVIEW_DIR;
const envFile = process.env.MYSQL_ENV_FILE;
assert(directory && isAbsolute(directory), 'Set MYSQL_MCP_PREVIEW_DIR to the isolated installation directory');
assert(
  envFile && isAbsolute(envFile) && existsSync(envFile),
  'Set MYSQL_ENV_FILE to an existing absolute local file path'
);
const requirePreview = createRequire(join(directory, 'package.json'));
const { Client } = requirePreview('@modelcontextprotocol/client');
const { StdioClientTransport } = requirePreview('@modelcontextprotocol/client/stdio');
const entry = resolve(directory, 'node_modules/@hechtcarmel/mysql-mcp-server/dist/index.js');
assert(existsSync(entry), 'The isolated MySQL MCP preview is not installed');
const client = new Client(
  { name: 'mysql-mcp-local-readonly-smoke', version: '1' },
  { versionNegotiation: { mode: 'auto' } }
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  // The file stays on the Mac. This override wins over any write flag in the file.
  env: { MYSQL_ENV_FILE: envFile, MYSQL_ALLOW_WRITE: 'false' },
  stderr: 'pipe'
});
// Consume diagnostics without echoing configuration, SQL, or database content.
transport.stderr?.resume();
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const query = tools.find(tool => tool.name === 'mysql_query');
  assert.equal(query?.annotations?.readOnlyHint, true, 'The preview must advertise read-only mode');
  assert.equal(query?.annotations?.destructiveHint, false);
  const result = await client.callTool(
    {
      name: 'mysql_query',
      arguments: {
        query: 'SELECT 1 AS connection_test',
        response_format: 'json'
      }
    },
    { timeout: 15000 }
  );
  assert.notEqual(result.isError, true, 'The bounded connection read failed');
  assert.deepEqual(result.structuredContent?.rows, [[1]]);
  const { resourceTemplates } = await client.listResourceTemplates();
  assert(resourceTemplates.some(template => template.uriTemplate === 'mysql://{database}/{table}'));
  console.log(
    JSON.stringify({
      ok: true,
      mode: 'READ_ONLY',
      protocolEra: client.getProtocolEra(),
      server: client.getServerVersion(),
      entry,
      query: 'SELECT 1',
      checks: ['env-file connection', 'read-only annotations', 'structured output', 'resource templates']
    })
  );
} finally {
  await client.close();
}
