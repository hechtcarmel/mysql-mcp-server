# Controlled Mac validation before merge

Run this trial only on the user's Mac after reviewing the change and its CI results. Do not upload, print, copy to the cloud, modify, or replace an existing connection file. Do not run the project's unit, integration, package, or aggregate test suites as this real local trial: unit suites contain write/rejection mocks that are outside its scope.

The trial script constructs exactly one SQL statement: `SELECT 1 AS connection_test`. It also reads MCP tool annotations and resource-template definitions. It does not read application records or schemas, construct/send mutation SQL, test rejected operations, use mocks, try incorrect passwords, create tables, grant permissions, or change server settings. It forces `MYSQL_ALLOW_WRITE=false` in the child environment even if the existing file enables writes.

The original installation and MCP client configuration remain untouched. No global reinstall is needed.

## Isolated install

1. Use Node.js 24 (minimum runtime 20.19).
2. Obtain the reviewed tarball from the task artifact or CI's `npm-package` artifact, which includes the matching `scripts/local-smoke.mjs`. The CI artifact contains the tarball and `SHA256SUMS`; run `shasum -a 256 -c SHA256SUMS` in the downloaded directory before installing. Keep the helper and tarball from the same reviewed revision.
3. Create an isolated preview directory. These commands install the tarball and the official client helper without changing the existing server installation:

   ```sh
   preview_dir="$(mktemp -d "${TMPDIR:-/tmp}/mysql-mcp-preview.XXXXXX")"
   npm install --prefix "$preview_dir" --ignore-scripts --no-audit --no-fund \
     /absolute/path/to/reviewed-mysql-mcp.tgz \
     @modelcontextprotocol/client@2.4.0
   ```

4. Run only the local smoke helper, passing the existing environment file by path:

   ```sh
   MYSQL_MCP_PREVIEW_DIR="$preview_dir" \
   MYSQL_ENV_FILE='/absolute/path/to/existing/mysql.env' \
     node "$preview_dir/node_modules/@hechtcarmel/mysql-mcp-server/scripts/local-smoke.mjs"
   ```

   The server reads the existing file locally. The helper does not parse or rewrite it. It invokes Node directly with an argument array, so password characters never pass through a shell command. Normal dotenv syntax still applies to the file; see [password handling](password-handling.md). If the existing file uses relative TLS paths, launch from the original server working directory; the helper preserves that directory and does not rewrite paths.

Each stage emits a safe JSON status: `validate-input`, `load-preview`, `connect`, `confirm-read-only-tool`, `select-one`, `resource-templates`, and `cleanup`. A failure exits nonzero and identifies its stage plus a sanitized category, the candidate process exit code/signal, the last allowlisted startup stage, and whether exit preceded cleanup; it never skips the trial because of a temporary-directory prefix or symlink. Normal macOS `/tmp` and `/var` aliases are resolved before use. The helper owns one observed candidate process and pins the expected July 2026 protocol, avoiding automatic negotiation's hidden disposable probe. Configuration parsing, process/module startup, stdio/protocol errors and confirmed database/TLS errors have separate categories. An unknown MCP failure is not classified as a database failure. Cleanup-generated exit status is reported separately from failure evidence.

A successful result reports `ok: true`, `mode: READ_ONLY`, protocol era, and the completed check names. It includes no password, environment contents, database names, or application rows. An account or network/TLS error ends the trial; investigate locally without guessing credentials or changing grants.

## Optional client trial and rollback

After the smoke check passes, a separate explicitly authorized client trial can use a new MCP entry pointing to:

```json
{
  "command": "node",
  "args": ["/absolute/preview/path/node_modules/@hechtcarmel/mysql-mcp-server/dist/index.js"],
  "env": {
    "MYSQL_ENV_FILE": "/absolute/path/to/existing/mysql.env",
    "MYSQL_ALLOW_WRITE": "false"
  }
}
```

Keep the current entry unchanged and avoid enabling both for the same agent simultaneously. The client trial must use only known-safe bounded reads. Do not run write, mock, or rejection checks there.

Rollback consists of stopping the preview and removing its separate MCP entry, if one was added. The original installation/configuration are still available. The temporary preview directory can be deleted after stopping its process. Nothing needs restoring in MySQL or in the existing connection file.

Record only the revision/tarball hash, Node/macOS version, success/failure, and the helper's allowlisted stage/category/code/exit/signal evidence. Never return connection-file contents, passwords, or raw driver errors to the cloud task. Merge and publication remain separate maintainer decisions after the local result is reviewed.
