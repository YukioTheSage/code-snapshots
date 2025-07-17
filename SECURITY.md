# Security Policy

## Supported versions

We actively support the following versions of CodeLapse with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 0.9.x   | ✅ Yes             |
| 0.8.x   | ⚠️ Limited support |
| < 0.8   | ❌ No              |

## Reporting a vulnerability

We take security seriously. If you discover a security vulnerability in CodeLapse, please report it responsibly.

### How to report

**For security vulnerabilities, please do NOT create a public GitHub issue.**

Instead, please report security issues by:

1. **Email**: Send details to the project maintainers (create a GitHub issue with minimal details and request private communication)
2. **GitHub Security Advisory**: Use GitHub's private vulnerability reporting feature
3. **Direct Message**: Contact maintainers directly through GitHub

### What to include

When reporting a security vulnerability, please include:

- **Description**: Clear description of the vulnerability
- **Impact**: Potential impact and attack scenarios
- **Reproduction**: Step-by-step instructions to reproduce
- **Environment**: CodeLapse version, VS Code version, OS
- **Proof of Concept**: If applicable, include PoC code (but don't exploit it)

### Response timeline

- **Acknowledgment**: Within 24-48 hours
- **Initial Assessment**: Within 1 week
- **Status Updates**: Weekly until resolved
- **Resolution**: Timeline depends on severity and complexity

### Disclosure process

1. **Private Disclosure**: Report received and acknowledged
2. **Investigation**: We investigate and develop a fix
3. **Coordination**: We coordinate with you on disclosure timeline
4. **Public Disclosure**: After fix is released, we publish security advisory

## Security considerations

### Data handling

**Local Data Storage:**
- Snapshots are stored locally in `.snapshots` directory
- No data is transmitted to external servers by default
- Configuration files may contain sensitive settings

**Experimental Features:**
- Semantic search features may send code to external APIs
- Users must explicitly enable and configure these features
- Clear warnings are provided about data privacy implications

### API key security

**For Experimental Features:**
- API keys should be stored securely
- Never commit API keys to version control
- Use environment variables or secure configuration
- Regularly rotate API keys

### File system access

**Extension Permissions:**
- CodeLapse requires file system access to create snapshots
- Access is limited to workspace directories
- No system-wide file access required

### Network security

**Default Behavior:**
- No network requests in core functionality
- All network features are opt-in
- Clear disclosure of any external communications

## Best practices for users

### Secure configuration

1. **API Keys**: Store API keys securely, never in code
2. **Workspace Security**: Be cautious with sensitive codebases
3. **Experimental Features**: Understand risks before enabling
4. **Regular Updates**: Keep CodeLapse updated to latest version

### Safe usage

1. **Sensitive Code**: Avoid using experimental features with proprietary code
2. **API Quotas**: Monitor usage of external APIs
3. **Backup Strategy**: Don't rely solely on snapshots for critical backups
4. **Access Control**: Secure your development environment

## Security features

### Built-in protections

- **Local-first**: Core functionality works entirely offline
- **Opt-in External Services**: All external integrations require explicit consent
- **Clear Warnings**: Experimental features include security warnings
- **Minimal Permissions**: Extension requests only necessary permissions

### Privacy protection

- **No Telemetry**: No usage data collected by default
- **Local Storage**: All snapshots stored locally
- **User Control**: Users control all data sharing decisions

## Vulnerability disclosure history

We will maintain a record of security vulnerabilities and their resolutions:

### 2024

- No security vulnerabilities reported to date

## Security contact

For security-related questions or concerns:

- Create a GitHub issue with the `security` label for general questions
- Use private reporting methods for actual vulnerabilities
- Check our documentation for security best practices

## Acknowledgments

We appreciate security researchers and users who help keep CodeLapse secure by reporting vulnerabilities responsibly.

## Legal

This security policy is provided in good faith. We reserve the right to modify this policy at any time. By using CodeLapse, you agree to follow responsible disclosure practices when reporting security issues.