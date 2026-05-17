const requiredKeys = ['DATABASE_URL', 'JWT_SECRET', 'REDIS_URL', 'PORT'] as const;

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

  return env;
}