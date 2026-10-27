# Agent-facing tool contract review

`mysql_query` remains the one SQL tool: its name identifies MySQL and the query operation without adding redundant variants. The description directs agents to schema resources for discovery, and to this tool for data reads and query plans. Write capability is described only when MYSQL_ALLOW_WRITE explicitly enables it.

The description is generated from the actual mode and configured retained-row limit. Shared constants supply the 50-statement and 25,000-character limits. It distinguishes retained output from database work: agents still need SQL LIMIT, predicates and selected columns. It names blocked SQL forms, whole-call transaction requirements, isError failures, lack of retries, uncertain write outcomes, and the account/routine security boundary without claiming a complete SQL sandbox.

Parameter documentation states that qualified names are preferred, while unqualified names use MYSQL_DATABASE. One bounded SELECT example is advertised through the same Zod schema used for runtime validation. The response_format description explains that both text formats also include structuredContent.

The output schema describes column positions, exact numeric and binary values, returned-versus-affected row counts, elapsed milliseconds, truncation, and concrete per-statement batch results. Batch metadata does not imply an aggregate count: top-level fields describe the first result, while top-level truncated summarizes omissions across the batch. Errors do not masquerade as successful structured output.

Annotations reflect configured behavior: readOnlyHint follows the mode, destructiveHint is enabled for DML, openWorldHint stays true for the external database, and idempotentHint is conservatively false. SQL routines and UDFs are not assumed idempotent. MCP annotations are client hints, not authorization controls; the SQL policy, read-only transaction and database grants implement the actual boundaries.

Discovery tests verify the exposed names, required/bounded inputs, examples, configured limits, output schema and annotations. Contract tests cover successful text/structured results, empty results, truncation, batch order, errors and resource discovery. All write/rejection tests run only in isolated cloud mocks; the real Mac trial uses only the separate read-only smoke helper.

Reviewed against the official [MCP SDK v2 tools guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md), including schema-derived argument documentation, structured-output validation and advisory annotations. No unsupported task, HTTP, retry or pagination capability is advertised for the query tool; result paging uses explicit SQL LIMIT/OFFSET, while resource listing uses MCP cursors.
