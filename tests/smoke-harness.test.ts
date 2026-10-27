// Cloud-only isolated harness tests. Never run this suite as the real Mac trial.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const entry = fileURLToPath(new URL('../scripts/local-smoke.mjs', import.meta.url));
const realClient = createRequire(import.meta.url).resolve('@modelcontextprotocol/client');
const sensitive = 'dummy-secret-marker-do-not-print';
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mysql-smoke-cloud-'));
  roots.push(root);
  const prefix = join(root, 'preview');
  const pkg = join(prefix, 'node_modules/@modelcontextprotocol/client');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(prefix, 'package.json'), '{"private":true}');
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: '@modelcontextprotocol/client', exports: { '.': './index.cjs', './stdio': './stdio.cjs' } })
  );
  writeFileSync(
    join(pkg, 'index.cjs'),
    `
    const fs = require('node:fs');
    const helpers = require(${JSON.stringify(realClient)});
    module.exports.deserializeMessage = helpers.deserializeMessage;
    module.exports.serializeMessage = helpers.serializeMessage;
    function trace(name, data) { fs.appendFileSync(process.env.SMOKE_FIXTURE_TRACE, JSON.stringify({name, data})+'\\n'); }
    function fail(stage) { if (process.env.SMOKE_FIXTURE_FAIL_STAGE===stage) throw new Error('${sensitive}'); }
    module.exports.Client = class {
      constructor() { fail('load-preview'); }
      async connect(transport) { this.transport=transport; await transport.start(); trace('connect'); if(process.env.SMOKE_FIXTURE_TIMEOUT){transport.stderr.write(JSON.stringify({event:'mysql-startup',stage:'database-connect',status:'started'})+'\\n');throw Object.assign(new Error('${sensitive}'),{code:'REQUEST_TIMEOUT'});} if(process.env.SMOKE_FIXTURE_FAIL_STAGE==='connect') transport.stderr.write(JSON.stringify({event:'mysql-startup',stage:'database-connect',status:'failed',category:'database-authentication-denied',message:'${sensitive}'})+'\\n'); fail('connect'); }
      getProtocolEra() { return 'modern'; }
      async listTools() { trace('list-tools'); fail('confirm-read-only-tool'); return {tools:[{name:'mysql_query', annotations:{readOnlyHint:process.env.SMOKE_FIXTURE_READ_ONLY!=='false',destructiveHint:false}}]}; }
      async callTool(params) { trace('query', params); fail('select-one'); if(params.arguments.query!=='SELECT 1 AS connection_test') throw new Error('Unexpected SQL'); return {structuredContent:{rows:[[process.env.SMOKE_FIXTURE_BAD_RESULT ? '${sensitive}' : 1]]}}; }
      async listResourceTemplates() { trace('resource-templates'); fail('resource-templates'); return {resourceTemplates:[{uriTemplate:'mysql://{database}/{table}'}]}; }
      async close() { trace('close'); await this.transport?.close(); fail('cleanup'); }
    };
  `
  );
  writeFileSync(join(pkg, 'stdio.cjs'), 'module.exports.getDefaultEnvironment = () => ({PATH:process.env.PATH});');
  const serverDir = join(prefix, 'node_modules/@hechtcarmel/mysql-mcp-server/dist');
  mkdirSync(join(serverDir, 'utils'), { recursive: true });
  writeFileSync(
    join(serverDir, 'utils/startup-error-codes.json'),
    readFileSync(new URL('../src/utils/startup-error-codes.json', import.meta.url))
  );
  writeFileSync(
    join(serverDir, 'index.js'),
    `const fs=require('node:fs'); fs.appendFileSync(${JSON.stringify(join(root, 'trace.jsonl'))}, JSON.stringify({name:'candidate-environment',data:{MYSQL_ENV_FILE:process.env.MYSQL_ENV_FILE,MYSQL_ALLOW_WRITE:process.env.MYSQL_ALLOW_WRITE,hasPassword:Object.hasOwn(process.env,'MYSQL_PASSWORD')}})+'\\n'); process.stdin.resume();process.stdin.on('end',()=>process.exit(0));`
  );
  const envFile = join(root, 'existing.env');
  writeFileSync(envFile, `MYSQL_PASSWORD=${sensitive}\nMYSQL_ALLOW_WRITE=true\n`);
  return { root, prefix, envFile, trace: join(root, 'trace.jsonl') };
}
function run(setup: ReturnType<typeof fixture>, extra: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [entry], {
    encoding: 'utf8',
    timeout: 15000,
    env: {
      PATH: process.env.PATH,
      MYSQL_MCP_PREVIEW_DIR: setup.prefix,
      MYSQL_ENV_FILE: setup.envFile,
      MYSQL_PASSWORD: sensitive,
      SMOKE_FIXTURE_TRACE: setup.trace,
      ...extra
    }
  });
  expect(result.error).toBeUndefined();
  expect(result.stdout + result.stderr).not.toContain(sensitive);
  expect(result.stdout + result.stderr).not.toContain(setup.root);
  const trace = (() => {
    try {
      return readFileSync(setup.trace, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  })();
  return {
    ...result,
    summary: JSON.parse(result.stdout),
    stages: result.stderr
      .trim()
      .split('\n')
      .map(line => JSON.parse(line)),
    trace
  };
}
describe('safe incremental Mac smoke diagnostics (cloud mocks only)', () => {
  it('executes through a symlinked temporary prefix and emits every stage', () => {
    const setup = fixture();
    const alias = join(setup.root, 'tmp-alias');
    symlinkSync(setup.prefix, alias, 'dir');
    const result = run({ ...setup, prefix: alias });
    expect(result.status).toBe(0);
    expect(result.summary).toMatchObject({ ok: true, mode: 'READ_ONLY', protocolEra: 'modern' });
    expect(result.stages.filter(stage => stage.status === 'passed').map(stage => stage.stage)).toEqual([
      'validate-input',
      'load-preview',
      'connect',
      'confirm-read-only-tool',
      'select-one',
      'resource-templates',
      'cleanup'
    ]);
    expect(result.trace.find(call => call.name === 'candidate-environment').data).toEqual({
      MYSQL_ENV_FILE: setup.envFile,
      MYSQL_ALLOW_WRITE: 'false',
      hasPassword: false
    });
    expect(result.trace.filter(call => call.name === 'query').map(call => call.data.arguments.query)).toEqual([
      'SELECT 1 AS connection_test'
    ]);
    expect(readFileSync(setup.envFile, 'utf8')).toContain('MYSQL_ALLOW_WRITE=true');
  });
  it.each(['load-preview', 'connect', 'confirm-read-only-tool', 'select-one', 'resource-templates', 'cleanup'])(
    'reports %s failure without exposing raw errors',
    failedStage => {
      const result = run(fixture(), { SMOKE_FIXTURE_FAIL_STAGE: failedStage });
      expect(result.status).toBe(1);
      expect(result.summary).toMatchObject({ ok: false, failedStage });
      expect(result.stages).toEqual(
        expect.arrayContaining([expect.objectContaining({ stage: failedStage, status: 'failed' })])
      );
      if (failedStage === 'connect') expect(result.summary.category).toBe('database-authentication-denied');
    }
  );
  it('keeps an MCP timeout distinct from an unconfirmed database failure', () => {
    const result = run(fixture(), { SMOKE_FIXTURE_TIMEOUT: 'true' });
    expect(result.summary).toMatchObject({
      ok: false,
      failedStage: 'connect',
      category: 'mcp-handshake-timeout',
      errorCode: 'REQUEST_TIMEOUT',
      evidence: { startup: { stage: 'database-connect', status: 'started', category: null } }
    });
    expect(result.summary.finalCandidate).toMatchObject({ exitCode: 0, exitSignal: null, exitBeforeCleanup: false });
  });
  it('never prints unexpected query results', () => {
    const result = run(fixture(), { SMOKE_FIXTURE_BAD_RESULT: 'true' });
    expect(result.status).toBe(1);
    expect(result.summary).toMatchObject({
      ok: false,
      failedStage: 'select-one',
      category: 'bounded-read-not-confirmed'
    });
  });
  it('fails explicitly for missing inputs instead of silently skipping', () => {
    const result = run(fixture(), { MYSQL_MCP_PREVIEW_DIR: '' });
    expect(result.status).toBe(1);
    expect(result.summary).toMatchObject({
      ok: false,
      failedStage: 'validate-input',
      category: 'absolute-preview-directory-required'
    });
    expect(result.trace).toEqual([]);
  });
  it('sanitizes a nonexistent local path failure', () => {
    const setup = fixture();
    const result = run(setup, { MYSQL_ENV_FILE: join(setup.root, 'missing.env') });
    expect(result.status).toBe(1);
    expect(result.summary).toMatchObject({
      ok: false,
      failedStage: 'validate-input',
      category: 'local-file-unavailable'
    });
  });
  it('never executes the fixed read if read-only mode is not confirmed', () => {
    const result = run(fixture(), { SMOKE_FIXTURE_READ_ONLY: 'false' });
    expect(result.status).toBe(1);
    expect(result.summary.category).toBe('read-only-mode-not-confirmed');
    expect(result.trace.filter(call => call.name === 'query')).toEqual([]);
  });
});
