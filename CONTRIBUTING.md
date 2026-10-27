# Contributing

Use Node.js 24 and the pnpm version declared in `package.json`. Node.js 20.19+ is retained for runtime compatibility. Install with `pnpm install --frozen-lockfile`.

Run `pnpm check` before submitting a change. It type-checks source and tests, lints with zero warnings, verifies formatting, runs unit tests, and builds the distributable. `pnpm test:coverage` reports coverage. Use `pnpm format` to format repository files.

Run the integration suite against a disposable database whenever changing SQL policy, metadata, database execution, MCP registration, dependencies, or lifecycle behavior. Follow the explicit `MYSQL_TEST_*` setup in [README.md](README.md#development-and-tests). The suite deliberately fails without an explicitly configured test target. It sends only safe bounded reads against existing system schemas. Do not add database fixture creation, mutations, rejection probes, incorrect-credential attempts, or settings/grant changes. SQL write paths belong in isolated cloud unit mocks only.

## Structure

- `src/index.ts`: CLI, startup, transport selection and shutdown.
- `src/server.ts`: testable MCP registration and protocol-level behavior.
- `src/services/config-loader.ts`: environment parsing and optional file loading.
- `src/services/query-parser.ts`: lexical SQL policy and batch validation.
- `src/services/mysql-client.ts`: bounded streaming, pooling, deadlines and cleanup.
- `src/services/query-executor.ts`: validation and driver-result adaptation.
- `src/services/metadata-service.ts`: prepared schema queries.
- `src/schemas/`, `src/tools/`, `src/resources/`, `src/utils/`: protocol schemas, handlers and output.
- `tests/*.test.ts`: isolated regression tests and in-memory MCP client tests.
- `tests/integration/`: real database and built-CLI tests with current and legacy clients.

Keep the package/command/tool names, environment configuration, resource URI patterns, default read-only behavior, and legacy text formats compatible. Add regression coverage for changed public behavior. Document intentional restrictions or runtime requirements in the upgrade notes and changelog.

Never write application logs to stdout, log SQL literals or driver error objects, introduce automatic write retries, or share a transaction between tool calls. Validate the whole batch before acquiring a connection. Keep `multipleStatements` disabled in mysql2.

`pnpm pack --pack-destination /tmp/mysql-mcp-package` performs a clean build and creates a reviewable tarball without publishing. Inspect its contents before a release. Package publication and version selection are separate maintainer actions; see [docs/releases.md](docs/releases.md) for draft-release and environment-scoped OIDC publishing workflows.

GitHub Actions are pinned to commit SHAs. Dependabot updates npm dependencies and Actions; review SDK changes as a group and keep both protocol eras covered. See [docs/architecture.md](docs/architecture.md) for design rationale.

`pnpm test:package` uses the same explicit `MYSQL_TEST_*` variables to build a tarball, install only its runtime dependencies in a temporary directory, inspect its contents, and run the CLI integration suite against the installed package. It requires npm registry access and cleans up afterward.
