# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in imrobot, please report it responsibly.

**Do not open a public issue.** Instead, email the maintainer or use GitHub's private vulnerability reporting feature.

## Scope

imrobot is a client-side library. The challenge generation and verification happen entirely in the browser. Keep in mind:

- The library is designed as a proof-of-concept reverse-CAPTCHA
- Challenge data is exposed in the DOM by design (agents need to read it)
- The `signature` field in `ImRobotToken` uses FNV-1a hashing, which is not cryptographically secure — it is intended for integrity checking, not authentication

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.6.x   | Yes (current)      |
| 0.5.x   | Yes                |
| 0.4.x   | Yes                |
| 0.3.x   | Security fixes only|
| < 0.3   | No                 |
