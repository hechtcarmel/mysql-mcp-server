# Password characters and configuration

The server passes `MYSQL_PASSWORD` unchanged to mysql2 as a connection option. It does not trim it, expand `$variables`, build a connection URL, URL-decode it, or percent-encode it. Do not percent-encode a password in `MYSQL_PASSWORD`; characters such as `@`, `:`, and `%` are literal in this field.

No server-side failure specific to `!` has been reproduced. Regression tests using dummy values cover `!`, `#`, `$`, single/double quotes, backslashes, `@`, `:`, `%`, leading/trailing spaces, and Unicode through environment parsing, JSON configuration, supported dotenv quoting, and mocked mysql2 pool options. They do not attempt authentication with guessed passwords or change any credentials.

A concrete configuration pitfall is reproducible: unquoted `#` starts a comment in dotenv. Shell expansion is another possible cause when credentials are embedded in commands; interactive shells can interpret `!`, `$`, backticks, quotes, and backslashes before the server receives them. Historical reports do not establish which path caused a particular failed connection.

## Existing environment files

Use dotenv quoting to preserve special characters. These values are deliberately fake examples:

```dotenv
MYSQL_PASSWORD='dummy!#$@:% value\literal'
```

Single quotes preserve backslashes and dollar signs literally. If a password contains a single quote, double quotes can be used when suitable; remember that dotenv double-quoted `\n` and `\r` sequences become newlines/carriage returns. Dotenv also supports backtick-quoted values, which can hold both single and double quotes. For values that are difficult to represent unambiguously in an environment file, pass an exact environment string through the client's JSON configuration instead of inventing escaping rules.

Keep leading/trailing spaces inside the quotation marks when they are part of the password. Never add escaping backslashes, shell quotes, or URL encoding to the actual password value unless the selected configuration format requires them. The server does not add a second decoding layer.

## JSON client configuration

JSON values are passed as environment strings without shell expansion:

```json
{
  "env": {
    "MYSQL_PASSWORD": "dummy!#$@:% with \"quotes\" and \\backslash"
  }
}
```

Use normal JSON escaping only. A `!` needs no special escaping. `$` does not expand. Do not put credentials in `command`, `args`, a shell command line, screenshots, logs, or shared configuration examples.

Existing process environment variables override the environment file, including an older password set by the client. When diagnosing a mismatch, check precedence locally without printing values. The Mac validation helper passes only the file path and the explicit read-only override, avoiding an inherited `MYSQL_PASSWORD` override.
