import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    // Environment
    NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    
    // Database (for private Lambda via Secrets Manager)
    DATABASE_SECRET_ARN: z.string().optional(),
    
    // AWS
    AWS_REGION: z.string().default('us-east-1'),
    AWS_PROFILE: z.string().optional(),
    
    // Bedrock
    BEDROCK_MODEL_ID: z.string().default('anthropic.claude-3-haiku-20240307-v1:0'),
    
    // Lambda
    LAMBDA_PRIVATE_NAME: z.string(),
    
    // Slack
    SLACK_BOT_TOKEN: z.string(),
    SLACK_SIGNING_SECRET: z.string(),
    SLACK_CLIENT_ID: z.string().optional(),
    SLACK_CLIENT_SECRET: z.string().optional(),
  },
  runtimeEnv: process.env,
});

// Type-safe config objects derived from env
export const databaseConfig = {
  secretArn: env.DATABASE_SECRET_ARN || undefined,
} as const;

export const awsConfig = {
  region: env.AWS_REGION,
  profile: env.AWS_PROFILE,
} as const;

export const bedrockConfig = {
  region: env.AWS_REGION,
  profile: env.AWS_PROFILE,
  modelId: env.BEDROCK_MODEL_ID,
} as const;

export const lambdaConfig = {
  region: env.AWS_REGION,
  profile: env.AWS_PROFILE,
  privateLambdaName: env.LAMBDA_PRIVATE_NAME,
} as const;

export const slackConfig = {
  botToken: env.SLACK_BOT_TOKEN,
  signingSecret: env.SLACK_SIGNING_SECRET,
  clientId: env.SLACK_CLIENT_ID,
  clientSecret: env.SLACK_CLIENT_SECRET,
} as const;

export const appConfig = {
  environment: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  database: databaseConfig,
  aws: awsConfig,
  bedrock: bedrockConfig,
  lambda: lambdaConfig,
  slack: slackConfig,
} as const;