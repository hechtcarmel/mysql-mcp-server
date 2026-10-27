# TLS diagnostics without MySQL authentication

mysql2 replaces a failed TLS error's `code` with `HANDSHAKE_SSL_ERROR`. The server keeps that wrapper code and adds bounded, allowlisted `error.tls` detail when available. Nested original TLS codes take precedence. A fixed OpenSSL reason or Node message signature can identify a likely cause after the original code was lost; `source: openssl-reason` or `source: message-signature` explicitly marks that inference. `source: error-code` means the code was retained directly. Unknown failures remain unclassified. Raw messages, hostnames, certificate contents and paths are never returned.

The categories distinguish certificate-chain verification, expiry/revocation, endpoint identity, protocol/cipher rejection and generic handshake failure. A protocol mismatch is not proof of a particular server configuration or of a plaintext endpoint.

## Separately scoped TLS-only probe

`scripts/local-tls-probe.mjs` is a diagnostic independent of the functional Mac trial. It does not use mysql2, load an env file, or read a MySQL username/password. It opens one bounded connection to the supplied existing host/port, reads the MySQL greeting, checks CLIENT_SSL, sends a **32-byte Protocol::SSLRequest**, verifies TLS, and disconnects immediately. It never constructs or sends a MySQL HandshakeResponse/login, authentication plugin response, SQL, or a TLS client certificate/key.

The SSLRequest ends before the username field. The probe always requires certificate-chain and DNS endpoint-identity verification and TLS 1.2+. No option disables these checks, no failed TLS attempt falls back to plaintext, and there is no automatic retry. The default deadline is 5 seconds, with a maximum of 10 seconds. Input/greeting sizes are bounded and sockets are destroyed on completion or failure.

Before running against a real endpoint, scope this separate diagnostic explicitly. Do not substitute an ordinary mysql2 connection: it would continue into authentication. Keep existing connection files and settings unchanged. A local controller may read the existing configuration locally and supply **only** these noncredential values in a fresh child environment:

| Input                        | Meaning                                                                   |
| ---------------------------- | ------------------------------------------------------------------------- |
| `MYSQL_HOST`                 | The same existing DNS hostname; never printed                             |
| `MYSQL_PORT`                 | The same port, default 3306                                               |
| `MYSQL_SSL_CA`               | Optional existing local CA file path; no certificate contents are printed |
| `MYSQL_TLS_PROBE_TIMEOUT_MS` | Optional deadline, default 5000, maximum 10000                            |

Do not pass the credential file, MYSQL_USER/PASSWORD, client-certificate/key material, auth flags, NODE_DEBUG or NODE_OPTIONS into the diagnostic process. The script does not read those credential fields even if present. Its Node TLS options are fixed and strict. No credential or environment-file content should leave the Mac.

After the diagnostic has been separately scoped and those noncredential values supplied locally, invoke the installed entrypoint:

```sh
node "$preview_dir/node_modules/@hechtcarmel/mysql-mcp-server/scripts/local-tls-probe.mjs"
```

It prints one sanitized JSON result containing the stage, success/failure, TLS-advertisement status, allowlisted error evidence, and `authenticationSent: false`. A successful probe confirms the endpoint's server TLS/trust/identity path for those inputs. It does **not** establish MySQL login success, account permissions, or client-certificate authentication support. In particular, a server requiring mTLS may need additional investigation; the probe intentionally supplies no client credentials.

The actual connection and fixed SELECT 1 acceptance gate still uses the packaged `local-smoke.mjs` under its authorized configuration. Never run write, rejection, mock, bad-password or aggregate suites during real local validation. Cloud probe tests use synthetic loopback endpoints and dummy certificates only, and inspect wire frames to assert zero MySQL authentication messages and no SQL.

## References

- [MySQL Protocol::SSLRequest](https://dev.mysql.com/doc/dev/mysql-server/latest/page_protocol_connection_phase_packets_protocol_ssl_request.html)
- [Node.js TLS client API](https://nodejs.org/api/tls.html#tlsconnectoptions-callback)
