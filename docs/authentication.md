# Authentication compatibility

## Default behavior and migration

`MYSQL_ENABLE_CLEARTEXT_PLUGIN` defaults to **false**. A startup failure with `MYSQL_CLEAR_PASSWORD_NOT_ENABLED` means the endpoint requested the client-side `mysql_clear_password` plugin and explicit opt-in was absent. It does not establish an incorrect password, a special-character parsing failure, a SQL error, or the endpoint's server-side authentication scheme.

The published server 1.0.0 declares mysql2 `^3.11.5`. Its source has no custom authentication handler or cleartext-specific transport enforcement. mysql2 3.11.5 accepted the built-in plugin automatically; upstream disabled it by default in **3.22.0**. The old dependency range can resolve newer 3.x versions, so inspect an old installation's actual driver version locally before attributing behavior to a specific version.

Old success is not evidence of secure transport. This plugin supplies the literal password, terminated by a null byte, to the authentication endpoint. TLS protects those bytes in transit, but the trusted endpoint still receives the credential. Without encryption and reliable endpoint authentication, an interceptor or impersonating endpoint could obtain it.

## Explicit guarded opt-in

For an endpoint that requires this plugin, the supported option is `MYSQL_ENABLE_CLEARTEXT_PLUGIN=true`. It never enables SQL writes. All of these conditions are required:

- TLS is enabled by `MYSQL_SSL=true` or existing certificate configuration.
- `MYSQL_SSL_REJECT_UNAUTHORIZED` is true (the default). Supply the correct CA chain locally with `MYSQL_SSL_CA` if system trust does not recognize the issuer.
- The existing `MYSQL_HOST` is a DNS name matching the server certificate. IP literals, URL-shaped values and host:port strings are refused for this mode. mysql2 skips its pre-authentication identity check for IP literals, so they cannot be accepted as an unchecked fallback.
- TLS 1.2 or 1.3 completes with an authorized certificate chain. Endpoint identity is verified before the driver's authentication exchange and checked again against the actual peer certificate before every cleartext response.
- The connection still uses the configured username/password. The plugin refuses credential changes instead of reusing a first-factor password for a later MFA factor or changeUser operation. This package supports one configured username/password, not additional authentication factors.

The implementation registers a guarded `mysql_clear_password` handler while leaving mysql2's unguarded `enableCleartextPlugin` shortcut false. Registering the handler also prevents the driver from sending its built-in initial cleartext response before the hook runs. Each callback requires a real, live, authorized TLS socket and rechecks the certificate and driver TLS policy; configuration alone is insufficient. There is no retry with weaker authentication or TLS.

If the endpoint lacks trusted TLS or its certificate does not match the existing DNS host, stop and obtain the correct nonsecret CA/hostname requirements from the database administrator. Do not disable verification, change credentials or grants, silently replace the existing host, or downgrade the driver to make the connection work. A separately authorized endpoint/account using another supported authentication method is an alternative.

## Controlled real local validation

Enabling the option for the user's actual endpoint requires approval of the exact local settings and the credential-disclosure risk above. Implementing the feature does not authorize enabling it on an existing connection. Do not modify the existing credential file or copy it to the cloud.

After that approval, the packaged helper accepts explicit noncredential environment overlays for `MYSQL_ENABLE_CLEARTEXT_PLUGIN`, `MYSQL_SSL`, `MYSQL_SSL_REJECT_UNAUTHORIZED`, and TLS certificate-file paths. It continues reading host/user/password from the unchanged existing env file and always forces MYSQL_ALLOW_WRITE=false. It does not automatically enable authentication or TLS. Run only that helper: SELECT 1 and safe MCP metadata, with no write, rejection, mock, bad-password or aggregate tests.

The C client's `LIBMYSQL_ENABLE_CLEARTEXT_PLUGIN` variable is not a setting for this Node.js server. Cloud tests use dummy credentials, ephemeral certificates and synthetic protocol endpoints with no database or SQL; they test both accepted TLS and blocked transport/plugin paths.

## References

- [mysql2 authentication and cleartext opt-in](https://sidorares.github.io/node-mysql2/docs/documentation/authentication-switch)
- [mysql2 change disabling the plugin by default](https://github.com/sidorares/node-mysql2/commit/884bec56288d827939d0dd3f1f4ae476fbc8dbeb)
- [MySQL client-side cleartext authentication](https://dev.mysql.com/doc/refman/8.4/en/cleartext-pluggable-authentication.html)
