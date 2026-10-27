// Real Mac trial only: one fixed SELECT plus MCP metadata. No aggregate suites.
import { realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, isAbsolute } from 'node:path';

class SmokeFailure extends Error {
  constructor(category) {
    super(category);
    this.category = category;
  }
}
const knownCodes = new Map([
  ['ER_ACCESS_DENIED_ERROR', 'database-access-denied'],
  ['ER_DBACCESS_DENIED_ERROR', 'database-access-denied'],
  ['ER_BAD_DB_ERROR', 'database-name-unavailable'],
  ['ECONNREFUSED', 'database-unreachable'],
  ['ENOTFOUND', 'database-host-unavailable'],
  ['ETIMEDOUT', 'connection-timeout'],
  ['ENOENT', 'local-file-unavailable'],
  ['EACCES', 'local-file-permission'],
  ['CERT_HAS_EXPIRED', 'tls-certificate-invalid'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls-certificate-invalid'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls-certificate-invalid']
]);
let stage = 'validate-input';
let serverCategory;
function report(status, category) {
  // Never echo file paths, server stderr, query responses, or error messages.
  process.stderr.write(
    JSON.stringify({ component: 'mysql-readonly-smoke', stage, status, ...(category && { category }) }) + '\n'
  );
}
async function runStage(name, work) {
  stage = name;
  report('started');
  const value = await work();
  report('passed');
  return value;
}
function categoryFor(error) {
  if (error instanceof SmokeFailure) return error.category;
  if (serverCategory) return serverCategory;
  if (error && typeof error.code === 'string' && knownCodes.has(error.code)) return knownCodes.get(error.code);
  return 'connection-or-protocol-check-failed';
}
function captureSafeDiagnostics(stream) {
  let pending = '';
  stream?.on('data', chunk => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    if (pending.length > 4096) pending = '';
    for (const line of lines) {
      if (line.length > 4096) continue;
      try {
        const record = JSON.parse(line);
        if (record && typeof record.code === 'string' && knownCodes.has(record.code)) {
          serverCategory = knownCodes.get(record.code);
        } else if (record?.level === 'error' && typeof record.message === 'string') {
          if (record.message === 'Could not read configured MySQL TLS files; check paths and permissions')
            serverCategory = 'tls-file-unavailable';
          if (record.message === 'Failed to load MYSQL_ENV_FILE') serverCategory = 'configuration-file-unavailable';
          if (record.message.startsWith('Missing required environment variables:'))
            serverCategory = 'required-configuration-missing';
        }
      } catch {
        /* Drain unrecognized diagnostics without printing them. */
      }
    }
  });
}

async function main() {
  let client;
  let transport;
  let protocolEra;
  let failed;
  try {
    const input = await runStage('validate-input', () => {
      const [major, minor] = process.versions.node.split('.').map(Number);
      if (major < 20 || (major === 20 && minor < 19)) throw new SmokeFailure('node-20.19-or-newer-required');
      const directory = process.env.MYSQL_MCP_PREVIEW_DIR;
      const envFile = process.env.MYSQL_ENV_FILE;
      if (!directory || !isAbsolute(directory)) throw new SmokeFailure('absolute-preview-directory-required');
      if (!envFile || !isAbsolute(envFile)) throw new SmokeFailure('absolute-existing-env-file-required');
      // Follow normal macOS /tmp and /var symlinks. No prefix guard can skip execution.
      const preview = realpathSync(directory);
      const file = realpathSync(envFile);
      if (!statSync(preview).isDirectory() || !statSync(file).isFile())
        throw new SmokeFailure('invalid-local-input-type');
      const entry = realpathSync(join(preview, 'node_modules/@hechtcarmel/mysql-mcp-server/dist/index.js'));
      if (!statSync(entry).isFile()) throw new SmokeFailure('preview-entry-unavailable');
      return { preview, file, entry };
    });
    await runStage('load-preview', () => {
      const requirePreview = createRequire(join(input.preview, 'package.json'));
      const { Client } = requirePreview('@modelcontextprotocol/client');
      const { StdioClientTransport } = requirePreview('@modelcontextprotocol/client/stdio');
      client = new Client(
        { name: 'mysql-mcp-local-readonly-smoke', version: '1' },
        {
          versionNegotiation: { mode: 'auto', probe: { timeoutMs: 15000, maxRetries: 0 } }
        }
      );
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [input.entry],
        // Existing credentials stay in the file; no inherited password override is forwarded.
        env: { MYSQL_ENV_FILE: input.file, MYSQL_ALLOW_WRITE: 'false' },
        stderr: 'pipe'
      });
      captureSafeDiagnostics(transport.stderr);
    });
    await runStage('connect', async () => {
      await client.connect(transport, { timeout: 15000 });
      protocolEra = client.getProtocolEra();
      if (!['modern', 'legacy'].includes(protocolEra)) throw new SmokeFailure('protocol-era-not-confirmed');
    });
    await runStage('confirm-read-only-tool', async () => {
      const { tools } = await client.listTools(undefined, { timeout: 15000 });
      const query = tools.find(tool => tool.name === 'mysql_query');
      if (query?.annotations?.readOnlyHint !== true || query?.annotations?.destructiveHint !== false) {
        throw new SmokeFailure('read-only-mode-not-confirmed');
      }
    });
    await runStage('select-one', async () => {
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
      const rows = result.structuredContent?.rows;
      if (
        result.isError === true ||
        !Array.isArray(rows) ||
        rows.length !== 1 ||
        !Array.isArray(rows[0]) ||
        rows[0].length !== 1 ||
        rows[0][0] !== 1
      ) {
        throw new SmokeFailure('bounded-read-not-confirmed');
      }
    });
    await runStage('resource-templates', async () => {
      const { resourceTemplates } = await client.listResourceTemplates(undefined, { timeout: 15000 });
      if (!resourceTemplates.some(template => template.uriTemplate === 'mysql://{database}/{table}')) {
        throw new SmokeFailure('resource-template-not-confirmed');
      }
    });
  } catch (error) {
    failed = { failedStage: stage, category: categoryFor(error) };
    report('failed', failed.category);
  } finally {
    if (client) {
      try {
        await runStage('cleanup', () => client.close());
      } catch {
        report('failed', 'cleanup-failed');
        failed ??= { failedStage: 'cleanup', category: 'cleanup-failed' };
      }
    }
  }
  if (failed) {
    process.exitCode = 1;
    process.stdout.write(JSON.stringify({ ok: false, ...failed }) + '\n');
  } else {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        mode: 'READ_ONLY',
        protocolEra,
        checks: ['env-file connection', 'read-only annotations', 'SELECT 1', 'resource templates']
      }) + '\n'
    );
  }
}
await main();
