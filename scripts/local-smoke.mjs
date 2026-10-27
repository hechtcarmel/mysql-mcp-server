// Real Mac trial only: one fixed SELECT plus MCP metadata. No aggregate suites.
import { realpathSync, statSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, isAbsolute, dirname } from 'node:path';
import { createObservedStdioTransport } from './smoke-transport.mjs';

class SmokeFailure extends Error {
  constructor(category) {
    super(category);
    this.category = category;
  }
}
const localCodes = new Map([
  ['ENOENT', 'local-file-unavailable'],
  ['EACCES', 'local-file-permission'],
  ['EPERM', 'local-file-permission']
]);
const stages = new Set(['configuration', 'database-pool', 'database-connect', 'mcp-transport']);
const categories = new Set([
  'configuration-file-unavailable',
  'required-configuration-missing',
  'configuration-boolean-invalid',
  'configuration-number-invalid',
  'tls-configuration-incomplete',
  'tls-file-unavailable',
  'tls-verification-required',
  'tls-dns-host-required',
  'configuration-parse-failed',
  'database-authentication-denied',
  'database-access-denied',
  'database-default-schema-unavailable',
  'database-connection-refused',
  'database-host-lookup-failed',
  'database-network-unreachable',
  'database-connect-timeout',
  'database-connection-reset',
  'database-connection-lost',
  'tls-certificate-invalid',
  'tls-material-invalid',
  'mcp-server-startup-failed',
  'server-startup-failed'
]);
const sdkCodes = new Set([
  'REQUEST_TIMEOUT',
  'CONNECTION_CLOSED',
  'ERA_NEGOTIATION_FAILED',
  'INVALID_RESULT',
  'NOT_CONNECTED',
  'SEND_FAILED',
  'SMOKE_INVALID_PROTOCOL',
  'SMOKE_STDIO_FAILED',
  'SMOKE_SPAWN_FAILED'
]);
let startupCodes = new Set();
let tlsCodes = new Set();
const tlsSources = new Set(['error-code', 'openssl-reason', 'message-signature']);
const errorClasses = new Set(['AggregateError', 'TypeError', 'RangeError', 'SyntaxError', 'Error', 'NonError']);
const codeStates = new Set(['recognized', 'missing', 'unrecognized']);
let stage = 'validate-input';
let startup = { seen: false, stage: null, status: null, category: null, error: null, ready: false, nodeFailure: null };
let observation;
function evidence() {
  return { startup: { ...startup }, candidate: observation?.snapshot() ?? null };
}
function report(status, category, details) {
  process.stderr.write(
    JSON.stringify({
      component: 'mysql-readonly-smoke',
      stage,
      status,
      ...(category && { category }),
      ...(details && { evidence: details })
    }) + '\n'
  );
}
async function runStage(name, work) {
  stage = name;
  report('started');
  const result = await work();
  report('passed');
  return result;
}
function categoryFor(error) {
  if (error instanceof SmokeFailure) return error.category;
  const facts = observation?.snapshot();
  if (startup.category) return startup.category;
  if (facts?.spawnError)
    return facts.spawnError === 'ENOENT' ? 'candidate-executable-unavailable' : 'candidate-spawn-failed';
  if (startup.nodeFailure) return startup.nodeFailure;
  if (facts?.invalidProtocolMessage) return 'mcp-invalid-stdout';
  if (facts?.exitBeforeCleanup && !startup.ready)
    return facts.exitSignal ? 'candidate-terminated-before-ready' : 'candidate-exited-before-ready';
  if (error?.code === 'REQUEST_TIMEOUT') return 'mcp-handshake-timeout';
  if (facts?.rpcErrorCode === -32601) return 'mcp-method-unavailable';
  if (facts?.rpcErrorCode) return 'mcp-protocol-request-rejected';
  if (error?.code === 'ERA_NEGOTIATION_FAILED')
    return facts?.receivedMessages === 0 ? 'mcp-no-protocol-response' : 'mcp-version-negotiation-failed';
  if (error?.code === 'INVALID_RESULT') return 'mcp-invalid-response';
  if (error?.code === 'CONNECTION_CLOSED')
    return startup.ready ? 'mcp-transport-closed' : 'candidate-transport-closed-before-ready';
  if (facts?.ioError || error?.code === 'SMOKE_STDIO_FAILED') return 'mcp-stdio-failed';
  if ((stage === 'validate-input' || stage === 'load-preview') && localCodes.has(error?.code))
    return localCodes.get(error.code);
  return stage === 'connect' ? 'mcp-connection-failed' : 'mcp-check-failed';
}
function errorCode(error) {
  return sdkCodes.has(error?.code)
    ? error.code
    : [-32700, -32600, -32601, -32602, -32603, -32022].includes(error?.code)
      ? error.code
      : null;
}
function safeErrorSummary(record) {
  return {
    errorClass: errorClasses.has(record?.errorClass) ? record.errorClass : 'NonError',
    code: startupCodes.has(record?.code) ? record.code : null,
    codeStatus: codeStates.has(record?.codeStatus) ? record.codeStatus : 'unrecognized',
    ...(tlsCodes.has(record?.tls?.code) &&
      tlsSources.has(record?.tls?.source) && { tls: { code: record.tls.code, source: record.tls.source } })
  };
}
function safeErrorDetails(record) {
  return {
    ...safeErrorSummary(record),
    causes: Array.isArray(record?.causes) ? record.causes.slice(0, 7).map(safeErrorSummary) : [],
    truncated: record?.truncated === true || (Array.isArray(record?.causes) && record.causes.length > 7)
  };
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
      // Recognize only fixed Node failure signatures, never echo the source line.
      if (/\b(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_REQUIRE_ESM)\b/.test(line))
        startup.nodeFailure = 'candidate-module-load-failed';
      if (/^SyntaxError:/.test(line)) startup.nodeFailure = 'candidate-syntax-error';
      try {
        const record = JSON.parse(line);
        if (
          record?.event !== 'mysql-startup' ||
          !stages.has(record.stage) ||
          !['started', 'ready', 'failed'].includes(record.status)
        )
          continue;
        startup.seen = true;
        startup.stage = record.stage;
        startup.status = record.status;
        if (record.stage === 'mcp-transport' && record.status === 'ready') startup.ready = true;
        if (record.status === 'failed') {
          startup.category = categories.has(record.category) ? record.category : 'server-startup-failed';
          startup.error = safeErrorDetails(record.error);
        }
      } catch {
        /* Drain all other stderr without retaining or printing it. */
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
      const catalog = JSON.parse(readFileSync(join(dirname(input.entry), 'utils/startup-error-codes.json'), 'utf8'));
      startupCodes = new Set(Object.keys(catalog));
      tlsCodes = new Set(
        Object.keys(catalog).filter(code => catalog[code].startsWith('tls-') && code !== 'HANDSHAKE_SSL_ERROR')
      );
      for (const category of Object.values(catalog)) categories.add(category);
      const requirePreview = createRequire(join(input.preview, 'package.json'));
      const { Client, deserializeMessage, serializeMessage } = requirePreview('@modelcontextprotocol/client');
      const { getDefaultEnvironment } = requirePreview('@modelcontextprotocol/client/stdio');
      client = new Client(
        { name: 'mysql-mcp-local-readonly-smoke', version: '1' },
        {
          versionNegotiation: { mode: { pin: '2026-07-28' } }
        }
      );
      transport = createObservedStdioTransport({
        entry: input.entry,
        deserializeMessage,
        serializeMessage,
        env: {
          ...getDefaultEnvironment(),
          // Explicit noncredential overlays only. Preserve the scoped transport
          // for the real trial; never inherit host/user/password values.
          ...Object.fromEntries(
            [
              'MYSQL_ENABLE_CLEARTEXT_PLUGIN',
              'MYSQL_SSL',
              'MYSQL_SSL_REJECT_UNAUTHORIZED',
              'MYSQL_SSL_CA',
              'MYSQL_SSL_CERT',
              'MYSQL_SSL_KEY'
            ]
              .filter(key => process.env[key] !== undefined)
              .map(key => [key, process.env[key]])
          ),
          MYSQL_ENV_FILE: input.file,
          MYSQL_ALLOW_WRITE: 'false'
        }
      });
      observation = transport;
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
    failed = { failedStage: stage, category: categoryFor(error), errorCode: errorCode(error), evidence: evidence() };
    report('failed', failed.category, failed.evidence);
  } finally {
    if (client) {
      try {
        await runStage('cleanup', async () => {
          try {
            await client.close();
          } finally {
            await transport?.close();
          }
        });
      } catch {
        report('failed', 'cleanup-failed');
        failed ??= { failedStage: 'cleanup', category: 'cleanup-failed' };
      }
    }
  }
  if (failed) {
    process.exitCode = 1;
    process.stdout.write(
      JSON.stringify({ ok: false, ...failed, finalCandidate: observation?.snapshot() ?? null }) + '\n'
    );
  } else {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        mode: 'READ_ONLY',
        protocolEra,
        candidate: observation?.snapshot() ?? null,
        checks: ['env-file connection', 'read-only annotations', 'SELECT 1', 'resource templates']
      }) + '\n'
    );
  }
}
await main();
