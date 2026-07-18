import { validateEnv, type EnvConfig } from './env.validation';

export interface AppConfig {
  nodeEnv: EnvConfig['NODE_ENV'];
  port: number;
  databaseUrl: string;
  redisUrl?: string;
  jwt: {
    accessSecret: string;
    accessExpiration: string;
    refreshSecret: string;
    refreshExpiration: string;
  };
  encryptionKey: string;
  llmPlatformKeys: {
    anthropic?: string;
    openai?: string;
  };
  frontendUrl?: string;
}

export default (): AppConfig => {
  const env = validateEnv(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessExpiration: env.JWT_ACCESS_EXPIRATION,
      refreshSecret: env.JWT_REFRESH_SECRET,
      refreshExpiration: env.JWT_REFRESH_EXPIRATION,
    },
    encryptionKey: env.ENCRYPTION_KEY,
    llmPlatformKeys: {
      anthropic: env.ANTHROPIC_API_KEY,
      openai: env.OPENAI_API_KEY,
    },
    frontendUrl: env.FRONTEND_URL,
  };
};
