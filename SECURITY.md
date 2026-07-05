# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities via
[GitHub private security advisories](https://github.com/x777/frontstage/security/advisories/new)
rather than a public issue.

## Key handling

fal.ai and OpenRouter keys never leave your machine — they're stored in the
desktop keychain or browser storage, and are never sent to or stored on any
Frontstage server.

## MCP server

The local MCP server binds to localhost only and requires a bearer token; it
is not reachable from outside the machine.
