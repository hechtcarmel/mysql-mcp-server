# Authentication and transport

## Public default and credential exposure

`MYSQL_ENABLE_CLEARTEXT_PLUGIN` defaults to **true** for all installations. An endpoint requesting `mysql_clear_password` receives the existing configured password, terminated by a null byte. The plugin works both with verified TLS and when TLS is disabled. It does not enable SQL writes: `MYSQL_ALLOW_WRITE=false` remains the default.

**Without TLS, that password is sent unencrypted.** Network observers or an impersonating endpoint may obtain it. Read-only SQL does not protect the credential. A VPN may protect only part of the route; it does not establish encryption from the VPN gateway to MySQL. Prefer certificate-verified TLS for remote connections. TLS encrypts the password in transit, but the authenticated endpoint still receives the literal credential.

To disable this plugin, set:

```dotenv
MYSQL_ENABLE_CLEARTEXT_PLUGIN=false
```

Other driver-supported authentication methods remain available. If an endpoint requests the disabled plugin, startup fails with `MYSQL_CLEAR_PASSWORD_NOT_ENABLED`. That code does not mean the password was wrong or special characters were parsed incorrectly, and it does not identify the endpoint's server-side authentication scheme. This application setting differs from the C client's `LIBMYSQL_ENABLE_CLEARTEXT_PLUGIN`, which is not used here.

## Transport selection and verified TLS

With no TLS configuration, the client uses the configured host/port over TCP. Existing env files containing host, username and password require no new authentication setting. IP hosts are supported in this mode. The plaintext credential risk above applies if the endpoint requests this plugin.

Enable verified TLS where supported:

```dotenv
MYSQL_SSL=true
# MYSQL_HOST must already be a DNS name matching the server certificate.
# Supply a local CA file only if the system trust store lacks the issuer:
# MYSQL_SSL_CA=/absolute/path/to/company-ca.pem
# Optional client certificates require both MYSQL_SSL_CERT and MYSQL_SSL_KEY.
```

Whenever TLS is configured, **regardless of the plugin setting**:

- Certificate-chain verification is required. `MYSQL_SSL_REJECT_UNAUTHORIZED=true` is the default; false is refused in TLS mode.
- `MYSQL_HOST` must be a certificate-matching DNS name. IP literals, URL-shaped hosts and host:port strings are refused. mysql2 skips its pre-authentication identity check for IP literals, so this package requires a DNS name for TLS.
- TLS 1.2 or 1.3 and endpoint-identity verification precede authentication. Each cleartext-plugin response rechecks the actual authorized TLS socket, supported protocol and peer certificate.
- TLS failure stops the connection. There is **no automatic retry or fallback to plaintext**. Certificate-file configuration also enables TLS, even when `MYSQL_SSL=false`; that flag cannot silently override existing CA/client-certificate settings.

Obtain the correct CA/hostname requirements from the database administrator if verification fails. Do not disable verification, change credentials or grants, silently replace the existing host, or downgrade the driver to bypass failure. Choosing a connection without TLS is a separate explicit configuration choice with the exposure described above.

## Driver hook and compatibility

The implementation uses a custom `mysql_clear_password` hook and keeps mysql2's unguarded `enableCleartextPlugin` shortcut false. That custom registration also prevents the built-in initial cleartext fast path. The hook handles the subsequent authentication exchange and binds every response to the configured host, port, username, password and selected live transport. It refuses unexpected context changes instead of reusing the first-factor credential for MFA or changeUser. This package supports one configured username/password, not additional authentication factors.

The published server 1.0.0 declares mysql2 `^3.11.5` and has no custom cleartext transport enforcement. mysql2 3.11.5 accepted the built-in plugin automatically; upstream disabled it by default in **3.22.0**. This package now makes its own compatibility default explicit. Old successful connections are not evidence of secure transport, and an old dependency range may resolve different driver versions.

Passwords remain unchanged through configuration and plugin encoding: no trimming, shell expansion, URL encoding or double decoding is applied. Follow [dotenv quoting guidance](password-handling.md) for special characters. The historical unquoted `#` truncation is dotenv syntax; a server-side `!` failure was not reproduced.

## Controlled real local validation

Keep the existing credential file on the user's machine, unchanged. Use only the final reviewed CI artifact against the approved endpoint and transport. The packaged `local-smoke.mjs` accepts explicit noncredential auth/TLS overlays while reading host/user/password from the existing env file and forcing MYSQL_ALLOW_WRITE=false. It does not automatically choose a different transport. Leaving the plugin setting absent uses the public true default; an existing false value remains an opt-out.

Run only that helper: fixed SELECT 1 and safe MCP metadata, with no write, rejection, mock, bad-password or aggregate tests. No password needs to be sent to the cloud or included in commands. The optional [TLS-only diagnostic](tls-diagnostics.md) is separate and stops before any MySQL login. Cloud authentication regressions use dummy credentials, ephemeral certificates and synthetic loopback endpoints with no database or SQL; they cover plaintext/default/opt-out, verified TLS and no fallback after TLS failure.

## References

- [mysql2 authentication and cleartext opt-in](https://sidorares.github.io/node-mysql2/docs/documentation/authentication-switch)
- [mysql2 change disabling the plugin by default](https://github.com/sidorares/node-mysql2/commit/884bec56288d827939d0dd3f1f4ae476fbc8dbeb)
- [MySQL client-side cleartext authentication](https://dev.mysql.com/doc/refman/8.4/en/cleartext-pluggable-authentication.html)
