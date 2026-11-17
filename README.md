# 📊 Uptime Monitor

A lightweight, self-hosted uptime monitoring solution with HTTP/HTTPS/Ping/DNS/TCP/SSL checks, real-time dashboard, and multi-channel alerting (Telegram, Email, Webhook).

![Dashboard Preview](https://via.placeholder.com/800x400/1a1b26/4fd1c5?text=Uptime+Monitor+Dashboard)

## ✨ Features

| Category | Features |
|----------|----------|
| **Checks** | HTTP/HTTPS, Ping (ICMP), TCP Port, DNS (A/AAAA/CNAME/MX/TXT/NS), SSL Certificate, Keyword |
| **Monitoring** | Configurable intervals (10s - 24h), retries, timeouts, custom headers/body, redirect following |
| **Alerts** | Telegram Bot, Email (SMTP), Generic Webhook (HMAC signed), per-monitor or global rules |
| **Dashboard** | Real-time updates (Socket.io), uptime/response time charts (Chart.js), incident timeline |
| **Incidents** | Auto-create/resolve, acknowledge, duration tracking, cause annotation |
| **Status Pages** | Public status pages with custom slugs, monitor grouping, themes |
| **Auth** | JWT-based, role-based access (Admin/Editor/Viewer), optional registration |
| **Data** | SQLite (default) or PostgreSQL, hourly/daily aggregations, configurable retention |
| **Deployment** | Docker (multi-stage), docker-compose, single binary-like deployment |

## 🚀 Quick Start

### Docker Compose (Recommended)

```bash
# Clone and enter directory
git clone https://github.com/yourusername/uptime-monitor.git
cd uptime-monitor

# Copy and edit environment
cp .env.example .env
# Edit .env with your settings

# Start with PostgreSQL (production-like)
docker compose -f docker/docker-compose.yml up -d

# Or start with SQLite only (simpler)
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e JWT_SECRET=$(openssl rand -base64 32) \
  uptime-monitor
```

### Local Development

```bash
# Install dependencies
npm install

# Start with SQLite (dev)
npm run dev

# Or with PostgreSQL
DATABASE_URL=postgresql://user:pass@localhost:5432/uptime npm run dev

# Run tests
npm test
```

### Access Dashboard

Open http://localhost:3000

Default: registration disabled → create first user via API or enable `ENABLE_REGISTRATION=true` in `.env`

## 📋 Configuration

All configuration via environment variables (see `.env.example`):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | - | Min 32 chars, generate with `openssl rand -base64 32` |
| `DATABASE_URL` | No | SQLite | PostgreSQL connection string |
| `DB_PATH` | No | `./data/uptime.db` | SQLite file path |
| `PORT` | No | `3000` | Server port |
| `TELEGRAM_BOT_TOKEN` | No | - | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | No | - | Comma-separated chat IDs |
| `SMTP_HOST` | No | - | SMTP server for email alerts |
| `WEBHOOK_URL` | No | - | Generic webhook endpoint |
| `WEBHOOK_SECRET` | No | - | HMAC-SHA256 secret for webhook signing |

## 🔧 Monitor Types

| Type | Description | Target Format |
|------|-------------|---------------|
| `http` | HTTP request | `https://api.example.com/health` |
| `https` | HTTPS request (same as http) | `https://example.com` |
| `ping` | ICMP ping | `example.com` or `1.1.1.1` |
| `tcp` | TCP port connect | `example.com:8080` |
| `dns` | DNS resolution | `example.com` |
| `ssl` | SSL certificate check | `example.com:443` |
| `keyword` | HTTP + keyword search | `https://status.example.com` |

## 🔔 Alert Rules

Create rules with conditions:
- **down** - Monitor is down
- **degraded** - Monitor is down or degraded
- **response_time** - Response time exceeds threshold (ms)
- **status_code** - Status code not in expected list
- **ssl_expiring** - SSL cert expires within N days

Channels: `telegram`, `email`, `webhook`

## 📊 API Endpoints

```
POST   /api/auth/register     - Register (if enabled)
POST   /api/auth/login        - Login
GET    /api/auth/me           - Current user

GET    /api/monitors          - List monitors
POST   /api/monitors          - Create monitor
GET    /api/monitors/:id      - Get monitor with stats
PATCH  /api/monitors/:id      - Update monitor
DELETE /api/monitors/:id      - Delete monitor
POST   /api/monitors/:id/check - Manual check

GET    /api/incidents         - List incidents
PATCH  /api/incidents/:id/resolve - Resolve incident

GET    /api/alert-rules       - List alert rules
POST   /api/alert-rules       - Create alert rule
PATCH  /api/alert-rules/:id   - Update alert rule
DELETE /api/alert-rules/:id   - Delete alert rule
POST   /api/alert-rules/:id/test - Test alert channel

GET    /api/status/:slug      - Public status page
GET    /api/dashboard/stats   - Dashboard summary
```

## 🐳 Deployment

### Render.com (Free Tier)

1. Fork this repo
2. Connect to Render → New Blueprint
3. Select repo → Apply
4. Render creates Web Service + PostgreSQL (Free)

### Railway / Fly.io / Koyeb

```bash
# Railway
railway login
railway init
railway up

# Fly.io
fly launch --dockerfile docker/Dockerfile
fly deploy

# Koyeb
koyeb init --docker docker/Dockerfile
```

### VPS with Docker

```bash
# On your server
git clone https://github.com/yourusername/uptime-monitor.git
cd uptime-monitor
cp .env.example .env
# Edit .env
docker compose -f docker/docker-compose.yml up -d
```

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Uptime Monitor                          │
├─────────────────────────────────────────────────────────────┤
│  Web Server (Express + Socket.io)                           │
│  ├─ REST API (/api/*)                                       │
│  ├─ WebSocket (real-time updates)                           │
│  └─ Static Dashboard (SPA)                                  │
├─────────────────────────────────────────────────────────────┤
│  Monitoring Engine                                          │
│  ├─ HTTP/HTTPS (axios)                                      │
│  ├─ Ping (ping package)                                     │
│  ├─ TCP (net.Socket)                                        │
│  ├─ DNS (dns/promises)                                      │
│  └─ SSL (tls.connect)                                       │
├─────────────────────────────────────────────────────────────┤
│  Alert System                                               │
│  ├─ Telegram (Telegraf)                                     │
│  ├─ Email (nodemailer)                                      │
│  └─ Webhook (axios + HMAC)                                  │
├─────────────────────────────────────────────────────────────┤
│  Database (Better-SQLite3 / pg)                             │
│  ├─ Monitors, Checks, Stats                                 │
│  ├─ Incidents, Alert Rules, History                         │
│  └─ Users, Settings, Status Pages                           │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
uptime-monitor/
├── docker/
│   ├── Dockerfile          # Multi-stage build
│   └── docker-compose.yml  # Local dev + PostgreSQL
├── src/
│   ├── index.js            # Entry point
│   ├── config.js           # Config with Zod validation
│   ├── db/
│   │   ├── index.js        # DB abstraction (SQLite/PG)
│   │   ├── schema.sql      # SQL schema
│   │   └── repositories.js # Data access layer
│   ├── monitors/
│   │   ├── index.js        # Monitoring engine
│   │   ├── http.js         # HTTP/HTTPS checks
│   │   ├── ping.js         # Ping/TCP checks
│   │   ├── dns.js          # DNS checks
│   │   └── ssl.js          # SSL certificate checks
│   ├── alerts/
│   │   ├── index.js        # Alert coordinator
│   │   ├── telegram.js     # Telegram bot
│   │   ├── email.js        # SMTP email
│   │   └── webhook.js      # Generic webhook
│   ├── api/
│   │   ├── routes.js       # REST API routes
│   │   └── middleware.js   # Auth, validation, rate limit
│   └── web/
│       ├── server.js       # Express + Socket.io + Static
│       └── public/         # Dashboard SPA
│           ├── index.html
│           ├── style.css
│           └── app.js
├── tests/                  # Unit tests
├── .github/workflows/ci.yml
├── .env.example
├── package.json
└── README.md
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Lint
npm run lint
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [Chart.js](https://www.chartjs.org/) - Beautiful charts
- [Telegraf](https://telegraf.js.org/) - Telegram bot framework
- [Better-SQLite3](https://github.com/WiseLibs/better-sqlite3) - Fast SQLite
- [Express](https://expressjs.com/) - Web framework
- [Socket.io](https://socket.io/) - Real-time engine

---

**Made with ❤️ for reliable monitoring**

[⭐ Star this repo](https://github.com/yourusername/uptime-monitor) if you find it useful!