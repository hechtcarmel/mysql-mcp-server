// Cloud-only stub processes and the real SDK. No database connection is made.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { startupErrorDetails } from '../src/utils/startup-diagnostics.js';
const roots: string[] = [];
const clientRoot = dirname(dirname(createRequire(import.meta.url).resolve('@modelcontextprotocol/client')));
const fixtureRequire = createRequire(import.meta.url);
const serverEntry = fixtureRequire.resolve('@modelcontextprotocol/server');
const serverStdio = fixtureRequire.resolve('@modelcontextprotocol/server/stdio');
const zod = fixtureRequire.resolve('zod');
const helper = fileURLToPath(new URL('../scripts/local-smoke.mjs', import.meta.url));
const secret = 'dummy-secret-hostname-and-connection-string-never-print';
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function run(program: string) {
  const root = mkdtempSync(join(tmpdir(), 'mysql-smoke-startup-'));
  roots.push(root);
  const sdkParent = join(root, 'node_modules/@modelcontextprotocol');
  mkdirSync(sdkParent, { recursive: true });
  symlinkSync(clientRoot, join(sdkParent, 'client'), 'dir');
  const dist = join(root, 'node_modules/@hechtcarmel/mysql-mcp-server/dist');
  mkdirSync(join(dist, 'utils'), { recursive: true });
  writeFileSync(
    join(dist, 'utils/startup-error-codes.json'),
    readFileSync(new URL('../src/utils/startup-error-codes.json', import.meta.url))
  );
  writeFileSync(join(root, 'package.json'), '{"private":true}');
  writeFileSync(
    join(dist, 'index.js'),
    `require('node:fs').appendFileSync(${JSON.stringify(join(root, 'launches'))}, 'started\\n');\n${program}`
  );
  const envFile = join(root, 'existing.env');
  writeFileSync(envFile, 'MYSQL_PASSWORD=' + secret + '\n');
  const result = spawnSync(process.execPath, [helper], {
    encoding: 'utf8',
    timeout: 10000,
    env: { PATH: process.env.PATH, MYSQL_MCP_PREVIEW_DIR: root, MYSQL_ENV_FILE: envFile }
  });
  expect(result.error).toBeUndefined();
  expect(result.stdout + result.stderr).not.toContain(secret);
  expect(result.stdout + result.stderr).not.toContain(root);
  return {
    code: result.status,
    result: JSON.parse(result.stdout),
    launches: readFileSync(join(root, 'launches'), 'utf8').trim().split('\n').length
  };
}
function startup(stage: string, category: string, error?: unknown) {
  return `process.stderr.write(JSON.stringify({event:'mysql-startup',stage:${JSON.stringify(stage)},status:'failed',category:${JSON.stringify(category)},error:${JSON.stringify(error)},message:${JSON.stringify(secret)}})+'\\n');process.exitCode=7;`;
}
describe('observed startup failures with the real MCP SDK', () => {
  it('completes the full helper against an isolated SDK server with no database', () => {
    const { code, result, launches } = run(`
      const {McpServer,ResourceTemplate}=require(${JSON.stringify(serverEntry)});
      const {serveStdio}=require(${JSON.stringify(serverStdio)});
      const {z}=require(${JSON.stringify(zod)});
      serveStdio(()=>{
        const server=new McpServer({name:'mysql-mcp-server',version:'1'});
        server.registerTool('mysql_query',{inputSchema:z.object({query:z.string(),response_format:z.string()}),annotations:{readOnlyHint:true,destructiveHint:false}},async ({query})=>{
          if(query!=='SELECT 1 AS connection_test') throw new Error('Unexpected query');
          return {content:[{type:'text',text:'safe constant'}],structuredContent:{rows:[[1]]}};
        });
        server.registerResource('Table',new ResourceTemplate('mysql://{database}/{table}',{list:undefined}),{},async ()=>({contents:[]}));
        return server;
      });
    `);
    expect(code).toBe(0);
    expect(launches).toBe(1);
    expect(result).toMatchObject({
      ok: true,
      mode: 'READ_ONLY',
      protocolEra: 'modern',
      candidate: { spawned: true, exited: true, exitCode: 0, exitSignal: null }
    });
  });
  it('captures configuration failure and natural exit before cleanup', () => {
    const { code, result } = run(startup('configuration', 'configuration-number-invalid'));
    expect(code).toBe(1);
    expect(result.category).toBe('configuration-number-invalid');
    expect(result.evidence.candidate).toMatchObject({
      spawned: true,
      exitCode: 7,
      exitSignal: null,
      exitBeforeCleanup: true
    });
    expect(result.finalCandidate).toMatchObject({ exited: true, exitCode: 7, exitSignal: null });
  });
  it('reports confirmed database authentication evidence without exposing driver errors', () => {
    const { result } = run(startup('database-connect', 'database-authentication-denied'));
    expect(result.category).toBe('database-authentication-denied');
    expect(result.evidence.startup.stage).toBe('database-connect');
  });
  it.each([
    ['HANDSHAKE_SSL_ERROR', 'tls-handshake-failed'],
    ['MYSQL_CLEAR_PASSWORD_NOT_ENABLED', 'database-cleartext-authentication-disabled']
  ])('retains the allowlisted %s failure through the complete helper without enabling it', (code, category) => {
    const details = startupErrorDetails(Object.assign(new Error(secret), { code }));
    const { result } = run(startup('database-connect', category, details));
    expect(result.category).toBe(category);
    expect(result.evidence.startup.error).toMatchObject({ errorClass: 'Error', code, codeStatus: 'recognized' });
    expect(result.finalCandidate).toMatchObject({ exitCode: 7, exitBeforeCleanup: true });
  });
  it('resanitizes spoofed diagnostic values and bounds nested details', () => {
    const malicious = {
      errorClass: secret,
      code: secret,
      codeStatus: secret,
      causes: Array.from({ length: 20 }, () => ({ errorClass: 'TypeError', code: secret, codeStatus: secret })),
      message: secret
    };
    const { result } = run(startup('database-connect', 'server-startup-failed', malicious));
    expect(result.evidence.startup.error).toMatchObject({
      errorClass: 'NonError',
      code: null,
      codeStatus: 'unrecognized',
      truncated: true
    });
    expect(result.evidence.startup.error.causes).toHaveLength(7);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it('does not infer a database fault from an opaque early process exit', () => {
    const { result } = run('process.exitCode=9;');
    expect(result.category).toBe('candidate-exited-before-ready');
    expect(result.evidence.startup.seen).toBe(false);
    expect(result.finalCandidate.exitCode).toBe(9);
  });
  it('retains a natural termination signal separately from cleanup', () => {
    const { result } = run("process.kill(process.pid,'SIGTERM');");
    expect(result.category).toBe('candidate-terminated-before-ready');
    expect(result.finalCandidate).toMatchObject({ exitCode: null, exitSignal: 'SIGTERM', exitBeforeCleanup: true });
  });
  it('classifies module-load failure using only a fixed Node signature', () => {
    const { result } = run(`process.stderr.write("Error [ERR_MODULE_NOT_FOUND]: ${secret}\\n");process.exitCode=12;`);
    expect(result.category).toBe('candidate-module-load-failed');
    expect(result.finalCandidate.exitCode).toBe(12);
  });
  it('redacts malformed stdout and keeps cleanup-caused exit separate', () => {
    const { result } = run(
      `process.stdout.write('${secret}\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));`
    );
    expect(result.category).toBe('mcp-invalid-stdout');
    expect(result.finalCandidate).toMatchObject({ exitCode: 0, exitBeforeCleanup: false });
  });
  it('reaps an uncooperative child and marks the cleanup signal explicitly', () => {
    const { result } = run(
      `process.on('SIGTERM',()=>{});process.stdin.resume();setInterval(()=>{},1000);process.stdout.write('${secret}\\n');`
    );
    expect(result.category).toBe('mcp-invalid-stdout');
    expect(result.finalCandidate).toMatchObject({
      exited: true,
      exitCode: null,
      exitSignal: 'SIGKILL',
      exitBeforeCleanup: false
    });
  });
  it('classifies protocol rejection without printing its message or blaming MySQL', () => {
    const { result } = run(
      `let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{text+=chunk;if(text.includes('\\n')){const request=JSON.parse(text.split('\\n')[0]);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'${secret}'}})+'\\n');}});process.stdin.on('end',()=>process.exit(0));`
    );
    expect(result.category).toBe('mcp-method-unavailable');
    expect(result.evidence.candidate.rpcErrorCode).toBe(-32601);
  });
});
