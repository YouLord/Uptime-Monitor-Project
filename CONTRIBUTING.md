# Contributing to Uptime Monitor

Thank you for your interest in contributing! 🎉

## 🚀 Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/yourusername/uptime-monitor.git`
3. **Create a branch**: `git checkout -b feature/your-feature-name`
4. **Make changes** and test
5. **Submit a Pull Request**

## 🛠 Development Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Start development server
npm run dev

# Run tests
npm test

# Lint code
npm run lint
```

## 📝 Code Style

- **ESLint** with standard config
- **Prettier** for formatting (run `npx prettier --write .`)
- **ES Modules** (import/export)
- **Async/await** over promises
- **JSDoc** for public functions

## 🧪 Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm test -- --coverage
```

### Writing Tests

- Place tests in `tests/` directory
- Name: `*.test.js`
- Use Node.js built-in test runner (`node --test`)
- Test file structure mirrors `src/`

## 🐛 Bug Reports

Use the [issue template](.github/ISSUE_TEMPLATE/bug_report.md) with:
- Clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Node version, Docker)
- Logs/screenshots

## ✨ Feature Requests

Use the [feature template](.github/ISSUE_TEMPLATE/feature_request.md) with:
- Clear use case
- Proposed solution
- Alternatives considered
- Implementation ideas

## 🔧 Code Areas

| Area | Files | Description |
|------|-------|-------------|
| **Config** | `src/config.js` | Zod-validated configuration |
| **Database** | `src/db/` | SQLite/PG abstraction, repositories |
| **Monitors** | `src/monitors/` | Check implementations |
| **Alerts** | `src/alerts/` | Telegram, Email, Webhook |
| **API** | `src/api/` | REST routes, middleware |
| **Dashboard** | `src/web/public/` | SPA (HTML/CSS/JS) |

## 🐳 Adding Monitor Types

1. Create `src/monitors/newtype.js` with `checkNewType(monitor)` function
2. Export from `src/monitors/index.js`
3. Add to `checkFunctions` map
3. Add form fields in `src/web/public/index.html` (conditional-fields)
4. Handle in `src/web/public/app.js` → `updateFormFields()`
5. Add tests in `tests/monitors/newtype.test.js`

## 🔐 Security

- Never commit secrets (`.env`, keys, tokens)
- Use parameterized queries (no string interpolation in SQL)
- Validate all inputs with Zod schemas
- Rate limit API endpoints
- Use HMAC for webhook signatures

## 📦 Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create git tag: `git tag v1.2.3`
4. Push tag: `git push origin v1.2.3`
5. GitHub Actions builds Docker image and publishes

## 💬 Communication

- **Issues**: Bug reports, feature requests
- **Discussions**: Questions, ideas, general chat
- **Discord**: [Join our server](https://discord.gg/uptime-monitor) (if exists)

## 📜 License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

Thank you for contributing! 🙏