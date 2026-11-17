/**
 * Configuration loader with validation
 * Supports .env, environment variables, and config.yaml
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { z } from 'zod';
import yaml from 'yaml';

// Schema for configuration validation
const ConfigSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Database
  DATABASE_URL: z.string().optional(),
  DB_PATH: z.string().default('./data/uptime.db'),
  
  // JWT
  JWT_SECRET: z.string().min(32).default('change-me-in-production-use-long-random-string'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  
  // Monitoring defaults
  DEFAULT_CHECK_INTERVAL: z.coerce.number().default(60), // seconds
  DEFAULT_TIMEOUT: z.coerce.number().default(10), // seconds
  DEFAULT_RETRIES: z.coerce.number().default(3),
  MAX_CONCURRENT_CHECKS: z.coerce.number().default(50),
  
  // Alerting
  ALERT_COOLDOWN: z.coerce.number().default(300), // seconds
  MAX_ALERT_HISTORY: z.coerce.number().default(1000),
  
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  
  // Email (SMTP)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  ALERT_EMAIL_TO: z.string().optional(),
  
  // Webhook
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  
  // Dashboard
  DASHBOARD_TITLE: z.string().default('Uptime Monitor'),
  DASHBOARD_THEME: z.enum(['light', 'dark', 'auto']).default('auto'),
  ENABLE_REGISTRATION: z.coerce.boolean().default(false),
  
  // Retention
  RETENTION_DAYS: z.coerce.number().default(30),
  RETENTION_HOURLY_DAYS: z.coerce.number().default(90),
  
  // Security
  RATE_LIMIT_WINDOW: z.coerce.number().default(900), // 15 min
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  CORS_ORIGIN: z.string().default('*'),
});

type Config = z.infer<typeof ConfigSchema>;

let config: Config | null = null;

function loadEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(path)) return env;
  
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length) {
      env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

function loadYamlConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const content = readFileSync(path, 'utf-8');
  return yaml.parse(content) || {};
}

export function getConfig(): Config {
  if (config) return config;
  
  // Load priority: defaults < .env < config.yaml < env vars
  const envPath = resolve(process.cwd(), '.env');
  const yamlPath = resolve(process.cwd(), 'config.yaml');
  
  const envConfig = loadEnvFile(envPath);
  const yamlConfig = loadYamlConfig(yamlPath);
  
  // Merge: process.env has highest priority
  const merged = {
    ...envConfig,
    ...yamlConfig,
    ...process.env
  };
  
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    console.error('❌ Configuration validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  
  config = result.data;
  return config;
}

export function resetConfig() {
  config = null;
}

export default getConfig;