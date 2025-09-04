import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    env: {
      NODE_ENV: 'development',
      DATABASE_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret',
      LAMBDA_PRIVATE_NAME: 'test-private-lambda',
      SLACK_BOT_TOKEN: 'xoxb-test-token',
      SLACK_SIGNING_SECRET: 'test-signing-secret',
    },
  },
});