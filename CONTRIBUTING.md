# Contributing to CodeLapse

Thank you for your interest in contributing to CodeLapse! We welcome contributions from the community and are excited to work with you.

## 🚀 Quick Start

1. **Fork the repository** on GitHub
2. **Clone your fork** locally: `git clone https://github.com/YOUR_USERNAME/code-snapshots.git`
3. **Install dependencies**: `npm install`
4. **Open in VS Code** and press `F5` to launch the Extension Development Host
5. **Make your changes** and test them
6. **Submit a pull request** with a clear description

## 📋 Development Setup

### Prerequisites

- **Node.js** (v14 or higher)
- **VS Code** (v1.75.0 or higher)
- **Git**

### Installation

```bash
# Clone the repository
git clone https://github.com/YukioTheSage/code-snapshots.git
cd code-snapshots

# Install dependencies
npm install

# Install CLI dependencies
cd cli
npm install
cd ..
```

### Building and testing

```bash
# Type checking
npm run check-types

# Build for development
npm run compile

# Build for production
npm run esbuild-prod

# Run linting
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

### Testing your changes

1. **Extension Testing**:
   - Open the project in VS Code
   - Press `F5` to launch Extension Development Host
   - Test your changes in the new VS Code window

2. **CLI Testing**:
   ```bash
   cd cli
   npm run build
   node dist/index.js --help
   ```

## 🎯 How to Contribute

### Reporting bugs

Before creating bug reports, please check the [existing issues](https://github.com/YukioTheSage/code-snapshots/issues) to avoid duplicates.

**When filing a bug report, please include**:
- Clear, descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- VS Code version and operating system
- Extension version
- Relevant logs (use `Snapshots: Show Extension Logs`)

### Suggesting features

We love feature suggestions! Please:
- Check existing [feature requests](https://github.com/YukioTheSage/code-snapshots/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement)
- Describe the problem you're trying to solve
- Explain your proposed solution
- Consider the impact on existing users

### Code contributions

#### Areas we need help with

- 🐛 **Bug fixes** - Check issues labeled `bug`
- ✨ **New features** - Check issues labeled `enhancement`
- 📚 **Documentation** - Always room for improvement
- 🧪 **Testing** - Help us improve test coverage
- 🎨 **UI/UX** - Make the extension more intuitive
- ⚡ **Performance** - Optimize snapshot operations

#### Coding guidelines

**TypeScript Style**:
- Use TypeScript for all new code
- Follow existing code style (we use Prettier)
- Add type annotations where helpful
- Use meaningful variable and function names

**Code Organization**:
- Keep functions focused and small
- Add JSDoc comments for public APIs
- Use consistent error handling patterns
- Follow the existing project structure

**Testing**:
- Add tests for new functionality
- Ensure existing tests pass
- Test edge cases and error conditions

#### Pull request process

1. **Create a feature branch**: `git checkout -b feature/your-feature-name`
2. **Make your changes** following our coding guidelines
3. **Test thoroughly** in the Extension Development Host
4. **Update documentation** if needed
5. **Run linting and formatting**: `npm run lint:fix && npm run format`
6. **Commit with clear messages** following [Conventional Commits](https://conventionalcommits.org/)
7. **Push to your fork**: `git push origin feature/your-feature-name`
8. **Create a pull request** with:
   - Clear title and description
   - Reference any related issues
   - Screenshots/GIFs for UI changes
   - Test instructions for reviewers

## 🏗️ Architecture Overview

### Extension structure

```text
src/
├── extension.ts          # Main extension entry point
├── commands.ts          # Command implementations
├── snapshotManager.ts   # Core snapshot logic
├── snapshotStorage.ts   # File system operations
├── services/           # Business logic services
├── ui/                # User interface components
├── types/             # TypeScript type definitions
└── utils/             # Utility functions
```

### Key components

- **SnapshotManager**: Core logic for creating and managing snapshots
- **SnapshotStorage**: Handles file system operations and data persistence
- **UI Components**: Tree views, webviews, and user interactions
- **Commands**: VS Code command implementations
- **Services**: Semantic search, Git integration, auto-snapshot rules

### CLI structure

```text
cli/
├── src/
│   ├── index.ts        # CLI entry point
│   ├── commands/       # CLI command implementations
│   └── utils/          # Shared utilities
└── dist/              # Compiled JavaScript
```

## 🔒 Security Considerations

### Experimental features

When working with experimental features (like semantic search):
- Always include appropriate warnings in documentation
- Implement opt-in mechanisms for risky features
- Consider data privacy implications
- Test with non-sensitive code first

### API key handling

- Never commit API keys or secrets
- Use environment variables for configuration
- Provide clear security warnings to users
- Implement secure storage mechanisms

## 📝 Documentation Standards

- Update relevant documentation for any changes
- Use clear, concise language
- Include code examples where helpful
- Test all documented procedures
- Follow the established documentation style

## 🤝 Community Guidelines

### Code of conduct

We are committed to providing a welcoming and inclusive environment. Please:
- Be respectful and constructive in all interactions
- Focus on what's best for the community
- Show empathy towards other community members
- Accept constructive criticism gracefully

### Communication

- **GitHub Issues**: Bug reports, feature requests, questions
- **Pull Requests**: Code contributions and discussions
- **Discussions**: General questions and community chat

## 🏷️ Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Release checklist (maintainers)

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Run full test suite
4. Build and test extension package
5. Create GitHub release with release notes
6. Publish to VS Code Marketplace

## 🙏 Recognition

Contributors are recognized in:
- GitHub contributors list
- Release notes for significant contributions
- Special thanks in documentation

## ❓ Questions?

- Check the [documentation](docs/)
- Read our [Troubleshooting Guide](docs/TROUBLESHOOTING.md)
- Search [existing issues](https://github.com/YukioTheSage/code-snapshots/issues)
- Use our [question template](.github/ISSUE_TEMPLATE/question.md) for support requests
- Join [GitHub Discussions](https://github.com/YukioTheSage/code-snapshots/discussions) for community chat

## 📋 Community Resources

- **[Code of Conduct](CODE_OF_CONDUCT.md)** - Our community standards
- **[Security Policy](SECURITY.md)** - How to report security issues
- **[Issue Templates](.github/ISSUE_TEMPLATE/)** - Structured issue reporting
- **[Maintainer Guide](.github/MAINTAINER_GUIDE.md)** - For project maintainers

Thank you for contributing to CodeLapse! 🎉