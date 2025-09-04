#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import * as cdk from 'aws-cdk-lib';
import { BookmarkStack } from './bookmark-stack.js';

// Load .env from project root (two levels up from this file)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '../../..');
config({ path: resolve(rootDir, '.env') });

const app = new cdk.App();

// Get environment from context or default to development
const environment = app.node.tryGetContext('environment') || 'development';

// Ensure account is defined for CDK deployment
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';

if (!account) {
  throw new Error('CDK_DEFAULT_ACCOUNT environment variable is required');
}

new BookmarkStack(app, `BookmarkBot-${environment}`, {
  environment,
  env: {
    account,
    region,
  },
  description: `Bookmark Slack Bot infrastructure (${environment})`,
});