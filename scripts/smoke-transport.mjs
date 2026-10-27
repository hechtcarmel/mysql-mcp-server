// Public MCP Transport interface over one owned child. No hidden probe process.
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';

const spawnCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC']);
const ioCodes = new Set(['EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED']);
const signals = new Set(['SIGTERM', 'SIGINT', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGBUS']);
const pause = ms =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });

export function createObservedStdioTransport({ entry, env, deserializeMessage, serializeMessage }) {
  const facts = {
    spawned: false,
    exited: false,
    exitCode: null,
    exitSignal: null,
    exitBeforeCleanup: false,
    cleanupRequested: false,
    spawnError: null,
    ioError: null,
    invalidProtocolMessage: false,
    receivedMessages: 0,
    rpcErrorCode: null
  };
  const stderr = new PassThrough();
  let pending = Buffer.alloc(0);
  let child;
  let closed;
  let closeTask;
  const transport = {
    stderr,
    get pid() {
      return child?.pid ?? null;
    },
    snapshot: () => ({ ...facts }),
    async start() {
      if (child) throw new Error('Transport already started');
      child = spawn(process.execPath, [entry], { env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      closed = new Promise(resolve => child.once('close', resolve));
      const started = new Promise((resolve, reject) => {
        child.once('spawn', () => {
          facts.spawned = true;
          resolve();
        });
        child.once('error', error => {
          facts.spawnError = spawnCodes.has(error?.code) ? error.code : 'OTHER';
          reject(Object.assign(new Error('Candidate process could not start'), { code: 'SMOKE_SPAWN_FAILED' }));
        });
      });
      child.once('exit', (code, signal) => {
        facts.exited = true;
        facts.exitCode = Number.isInteger(code) ? code : null;
        facts.exitSignal = signals.has(signal) ? signal : signal ? 'OTHER' : null;
        facts.exitBeforeCleanup = !facts.cleanupRequested;
      });
      child.once('close', () => {
        pending = Buffer.alloc(0);
        transport.onclose?.();
      });
      child.stderr?.pipe(stderr);
      child.stdout?.on('data', chunk => {
        try {
          if (pending.length + chunk.length > 1024 * 1024) throw new Error('Protocol buffer exceeded');
          pending = Buffer.concat([pending, chunk]);
          let newline;
          while ((newline = pending.indexOf('\n')) !== -1) {
            const line = pending.toString('utf8', 0, newline).replace(/\r$/, '');
            pending = pending.subarray(newline + 1);
            // The SDK's ReadBuffer intentionally skips invalid JSON lines. This
            // diagnostic adapter uses its public strict decoder to report them.
            const message = deserializeMessage(line);
            facts.receivedMessages++;
            if ([-32700, -32600, -32601, -32602, -32603, -32022].includes(message.error?.code))
              facts.rpcErrorCode = message.error.code;
            transport.onmessage?.(message);
          }
        } catch {
          facts.invalidProtocolMessage = true;
          // Deliberately discard parser errors that might contain raw stdout.
          transport.onerror?.(Object.assign(new Error('Invalid protocol output'), { code: 'SMOKE_INVALID_PROTOCOL' }));
          void transport.close().catch(() => {});
        }
      });
      const onIOError = error => {
        facts.ioError = ioCodes.has(error?.code) ? error.code : 'OTHER';
        transport.onerror?.(Object.assign(new Error('Candidate transport I/O failed'), { code: 'SMOKE_STDIO_FAILED' }));
        void transport.close().catch(() => {});
      };
      child.stdin?.on('error', onIOError);
      child.stdout?.on('error', onIOError);
      await started;
    },
    async send(message) {
      if (!child?.stdin || child.stdin.destroyed)
        throw Object.assign(new Error('Transport unavailable'), { code: 'SMOKE_STDIO_FAILED' });
      await new Promise((resolve, reject) =>
        child.stdin.write(serializeMessage(message), error => (error ? reject(error) : resolve()))
      );
    },
    close() {
      closeTask ??= (async () => {
        if (!child) return;
        facts.cleanupRequested = true;
        if (child.exitCode !== null || child.signalCode !== null) facts.exitBeforeCleanup = true;
        if (child.exitCode === null && child.signalCode === null) child.stdin?.end();
        await Promise.race([closed, pause(1000)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        await Promise.race([closed, pause(1000)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await closed;
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
        pending = Buffer.alloc(0);
      })();
      return closeTask;
    }
  };
  return transport;
}
