const requiredKeys = [
  'DATABASE_URL',
  'JWT_SECRET',
  'REDIS_URL',
  'PORT',
  'ENCRYPTION_SECRET',
] as const;

export function validateEnv(env: Record<string, string | undefined>) {
  if (process.env.NODE_ENV === 'test') {
    return env;
  }

  const missingKeys = requiredKeys.filter((key) => !env[key]);

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingKeys.join(', ')}`,
    );
  }

  // ENCRYPTION_SECRET is hashed to a 32-byte key (so any length technically
  // works), but a short secret is weak. Warn loudly rather than failing.
  const encSecret = env['ENCRYPTION_SECRET'] ?? '';
  if (encSecret.length < 16) {
    console.warn(
      `[env] ENCRYPTION_SECRET is only ${encSecret.length} chars — use at least 32 random chars for production.`,
    );
  }
  if ((env['JWT_SECRET'] ?? '').length < 16) {
    console.warn(
      '[env] JWT_SECRET is short — use a long, random value for production.',
    );
  }

  return env;
}
