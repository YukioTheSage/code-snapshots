# Maintainer Guide

This guide is for project maintainers and covers release processes, community management, and project governance.

## 🚀 Release Process

### Version Planning

**Release Types:**
- **Patch (0.0.X)**: Bug fixes, security updates, minor improvements
- **Minor (0.X.0)**: New features, significant improvements, experimental features
- **Major (X.0.0)**: Breaking changes, major architectural changes

**Release Schedule:**
- Patch releases: As needed for critical bugs
- Minor releases: Monthly or when significant features are ready
- Major releases: Quarterly or when breaking changes are necessary

### Pre-Release Checklist

**Code Quality:**
- [ ] All tests pass
- [ ] No critical linting errors
- [ ] Performance benchmarks are acceptable
- [ ] Security scan completed
- [ ] Dependencies are up to date

**Documentation:**
- [ ] CHANGELOG.md updated
- [ ] README.md reflects new features
- [ ] API documentation updated
- [ ] Migration guide created (for breaking changes)

**Testing:**
- [ ] Manual testing completed
- [ ] Extension tested in multiple VS Code versions
- [ ] CLI tested on multiple platforms
- [ ] Backward compatibility verified
- [ ] Performance regression testing

### Release Steps

1. **Prepare Release Branch**
   ```bash
   git checkout -b release/v0.X.Y
   ```

2. **Update Version Numbers**
   ```bash
   # Update package.json
   npm version patch|minor|major --no-git-tag-version
   
   # Update CLI package.json
   cd cli
   npm version patch|minor|major --no-git-tag-version
   cd ..
   ```

3. **Update Documentation**
   - Update CHANGELOG.md with release notes
   - Update version references in documentation
   - Update screenshots if UI changed

4. **Build and Test**
   ```bash
   npm run esbuild-prod
   npm run package
   
   # Test the packaged extension
   code --install-extension vscode-snapshots-*.vsix
   ```

5. **Create Release PR**
   - Create PR from release branch to main
   - Get approval from at least one other maintainer
   - Merge after approval

6. **Tag and Release**
   ```bash
   git tag v0.X.Y
   git push origin v0.X.Y
   ```

7. **Publish to Marketplace**
   ```bash
   vsce publish
   ```

8. **Create GitHub Release**
   - Create release on GitHub with tag
   - Include changelog in release notes
   - Attach .vsix file to release

9. **Post-Release**
   - Announce on relevant channels
   - Monitor for issues
   - Update project boards

### Hotfix Process

For critical bugs that need immediate release:

1. Create hotfix branch from main: `git checkout -b hotfix/v0.X.Y`
2. Fix the issue with minimal changes
3. Test thoroughly
4. Follow abbreviated release process
5. Merge hotfix back to main and develop branches

## 👥 Community Management

### Issue Triage

**Labels to Use:**
- `bug` - Confirmed bugs
- `enhancement` - Feature requests
- `question` - Support questions
- `documentation` - Documentation improvements
- `good first issue` - Good for new contributors
- `help wanted` - Community help needed
- `needs-triage` - Needs initial review
- `wontfix` - Won't be implemented
- `duplicate` - Duplicate issue

**Triage Process:**
1. **Initial Response** (within 24-48 hours)
   - Thank the contributor
   - Add appropriate labels
   - Ask for clarification if needed
   - Assign to milestone if applicable

2. **Investigation** (within 1 week)
   - Reproduce bugs
   - Evaluate feature requests
   - Provide initial feedback

3. **Resolution** (timeline varies)
   - Fix bugs or implement features
   - Close with explanation if not implementing
   - Guide community contributions

### Pull Request Review

**Review Checklist:**
- [ ] Code quality and style
- [ ] Tests included and passing
- [ ] Documentation updated
- [ ] No breaking changes (or properly documented)
- [ ] Performance impact acceptable
- [ ] Security considerations addressed

**Review Process:**
1. **Initial Review** (within 2-3 days)
   - Check for obvious issues
   - Provide initial feedback
   - Request changes if needed

2. **Detailed Review** (after initial issues resolved)
   - Thorough code review
   - Test the changes
   - Approve or request final changes

3. **Merge** (after approval)
   - Squash commits if needed
   - Use descriptive merge commit message
   - Delete feature branch

### Community Engagement

**Regular Activities:**
- Monitor GitHub issues and discussions
- Respond to community questions
- Review and merge contributions
- Update project documentation
- Participate in VS Code extension community

**Monthly Tasks:**
- Review project metrics and usage
- Update roadmap based on feedback
- Clean up stale issues and PRs
- Update dependencies

## 📊 Project Governance

### Decision Making

**Types of Decisions:**
- **Minor**: Bug fixes, small improvements (any maintainer)
- **Major**: New features, API changes (consensus required)
- **Breaking**: Breaking changes, architecture changes (all maintainers)

**Process:**
1. Create GitHub issue for discussion
2. Allow community input (minimum 1 week for major changes)
3. Reach consensus among maintainers
4. Document decision and rationale

### Maintainer Responsibilities

**Core Maintainers:**
- Make final decisions on project direction
- Review and approve major changes
- Manage releases
- Ensure code quality standards

**Contributing Maintainers:**
- Review pull requests
- Triage issues
- Help with community support
- Contribute code and documentation

### Adding New Maintainers

**Criteria:**
- Consistent, high-quality contributions
- Good understanding of project architecture
- Positive community interactions
- Commitment to project values

**Process:**
1. Existing maintainer nominates candidate
2. Discussion among current maintainers
3. Consensus required for approval
4. Invite to maintainer team with appropriate permissions

## 🔧 Tools and Automation

### GitHub Actions

**Current Workflows:**
- CI/CD pipeline for testing and building
- Automated dependency updates
- Security scanning
- Performance benchmarking

**Maintenance:**
- Review workflow runs regularly
- Update actions to latest versions
- Monitor for security alerts

### Monitoring and Analytics

**Metrics to Track:**
- Extension downloads and ratings
- GitHub stars and forks
- Issue resolution time
- Community engagement
- Performance metrics

**Tools:**
- VS Code Marketplace analytics
- GitHub Insights
- Extension telemetry (if implemented)

## 🚨 Incident Response

### Security Issues

**Process:**
1. Acknowledge receipt within 24 hours
2. Assess severity and impact
3. Develop fix privately
4. Coordinate disclosure timeline
5. Release security update
6. Publish security advisory

### Critical Bugs

**Process:**
1. Assess impact and urgency
2. Create hotfix branch if needed
3. Develop and test fix
4. Release emergency update
5. Communicate with affected users

## 📚 Knowledge Management

### Documentation Maintenance

**Regular Reviews:**
- Quarterly documentation review
- Update screenshots and examples
- Verify all links work
- Check for outdated information

**Style Guide:**
- Follow established documentation standards
- Use consistent terminology
- Include practical examples
- Keep language clear and concise

### Onboarding New Maintainers

**Checklist:**
- [ ] Add to GitHub team with appropriate permissions
- [ ] Share access to necessary tools and accounts
- [ ] Review maintainer responsibilities
- [ ] Introduce to community
- [ ] Pair on first few reviews/releases

## 🎯 Long-term Planning

### Roadmap Management

**Process:**
1. Collect community feedback
2. Analyze usage patterns and pain points
3. Evaluate technical debt and architecture needs
4. Plan features and improvements
5. Communicate roadmap to community

**Review Schedule:**
- Monthly: Review progress and adjust priorities
- Quarterly: Major roadmap updates
- Annually: Strategic planning and goal setting

### Sustainability

**Considerations:**
- Maintainer burnout prevention
- Community growth and engagement
- Technical debt management
- Long-term project viability

**Strategies:**
- Distribute maintenance responsibilities
- Encourage community contributions
- Regular refactoring and cleanup
- Clear project boundaries and scope