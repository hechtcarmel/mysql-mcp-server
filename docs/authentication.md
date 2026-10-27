# Authentication compatibility

## Cleartext authentication is disabled

A startup failure with `MYSQL_CLEAR_PASSWORD_NOT_ENABLED` means the endpoint requested the client-side `mysql_clear_password` plugin and mysql2 refused it because explicit opt-in was absent. It does not establish an incorrect password, a special-character parsing failure, a SQL error, or the endpoint's server-side authentication scheme.

The published server 1.0.0 declares mysql2 `^3.11.5`. Its package source has no custom authentication handler, no cleartext-authentication opt-in, and no additional transport check for this plugin. mysql2 3.11.5 accepted the built-in plugin automatically. Upstream disabled it by default in **3.22.0**; this server uses 3.24.6. The published dependency range can also resolve newer 3.x versions, so the exact driver installed in an old deployment must be inspected locally before attributing its behavior to a particular version.

The older automatic behavior is not evidence that a connection was secure. The plugin returns the literal password, terminated by a null byte, to the authentication endpoint. TLS can protect those bytes in transit, but the endpoint still receives the credential. Without encryption and reliable endpoint authentication, an interceptor or impersonating endpoint could obtain it.

The MCP server currently exposes no environment option for enabling this plugin. Reusing an existing env file preserves its configuration format; it does not override mysql2's authentication policy. The C client's `LIBMYSQL_ENABLE_CLEARTEXT_PLUGIN` variable is not a supported setting for this Node.js server.

## Safe compatibility route

Supporting an endpoint that requires this plugin would require a separately reviewed explicit opt-in, disabled by default, and transport checks that fail closed before releasing a credential. The route must require TLS, certificate-chain validation, and verification that the certificate matches the intended endpoint. In mysql2, `rejectUnauthorized: true` alone does not enable hostname verification; `verifyIdentity` is separate. IP-literal connections also need explicit identity handling rather than relying on the driver's omitted DNS server name.

No automatic retry, TLS downgrade, disabled certificate validation, custom-plugin bypass, or older driver should be used to make the connection succeed. A DBA-provided endpoint/account using another supported authentication method is an alternative, subject to its own authorization; this server does not change database accounts, authentication settings or grants.

The current implementation leaves the upstream guard in place. Any future opt-in must be implemented and tested in isolated cloud checks, then explicitly authorized for the specific local configuration before use. Do not modify the existing connection file or make another real connection attempt merely to probe this failure. Local validation remains limited to the packaged read-only helper, with no write, rejection, mock, bad-password or aggregate tests.

## References

- [mysql2 authentication and cleartext opt-in](https://sidorares.github.io/node-mysql2/docs/documentation/authentication-switch)
- [mysql2 change disabling the plugin by default](https://github.com/sidorares/node-mysql2/commit/884bec56288d827939d0dd3f1f4ae476fbc8dbeb)
- [MySQL client-side cleartext authentication](https://dev.mysql.com/doc/refman/8.4/en/cleartext-pluggable-authentication.html)
