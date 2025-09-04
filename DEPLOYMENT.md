# Deployment Guide

## Prerequisites

- Node.js 20+
- AWS CLI configured with appropriate permissions
- AWS CDK CLI installed (`npm install -g aws-cdk`)

## Environment Setup

1. **Copy environment template:**
   ```bash
   cp .env.example .env
   ```

2. **Configure environment variables:**
   ```bash
   # Required for CDK deployment
   export SLACK_BOT_TOKEN="xoxb-your-bot-token"
   export SLACK_SIGNING_SECRET="your-signing-secret"
   export BEDROCK_MODEL_ID="anthropic.claude-3-haiku-20240307-v1:0"
   
   # Optional AWS configuration
   export AWS_REGION="us-east-1"
   export CDK_DEFAULT_REGION="us-east-1"
   ```

## Deployment Steps

### 1. Build Verification
```bash
npm run verify-build
```

### 2. Bootstrap AWS CDK (first time only)
```bash
cd packages/infrastructure
npm run bootstrap
```

### 3. Deploy Infrastructure
```bash
# Development environment
npm run deploy:dev

# Production environment  
npm run deploy:prod
```

### 4. Initialize Database Schema
```bash
# After successful deployment
npm run init-db:dev

# Or for production
npm run init-db:prod
```

### 5. Configure Slack App

1. Go to [Slack API Console](https://api.slack.com/apps)
2. Create new app or update existing app
3. Set **Request URL** to the webhook URL from deployment output:
   ```
   https://your-api-id.execute-api.us-east-1.amazonaws.com/development/slack/events
   ```
4. **Required OAuth Scopes:**
   - `app_mentions:read`
   - `channels:history`
   - `chat:write`
   - `commands`

5. **Slash Commands:** Create these commands:
   - `/bookmark` - Description: "Save a bookmark"
   - `/bookmarks` - Description: "Search your bookmarks"  
   - `/bookmark-help` - Description: "Show bookmark help"

## Architecture Overview

### Dual Lambda Architecture
- **Public Lambda**: Handles Slack events, Bedrock AI, web scraping (outside VPC)
- **Private Lambda**: Database operations only (inside VPC)

### AWS Resources Created
- **VPC**: Custom VPC with public and private subnets (no NAT Gateway)
- **RDS**: PostgreSQL database in private subnets
- **Lambda**: Two functions with proper IAM roles
- **API Gateway**: REST API for Slack webhook
- **Secrets Manager**: Database credentials
- **VPC Endpoint**: Secrets Manager access

### Cost Optimization
- **No NAT Gateway**: Saves ~$45/month per AZ
- **VPC Endpoints**: ~$7/month vs NAT Gateway
- **Serverless**: Pay per request
- **t3.micro RDS**: Minimal database costs

## Commands Reference

```bash
# Build and test
npm run verify-build          # Complete build verification
npm run build                 # Build all packages
npm run test                  # Run all tests
npm run type-check           # TypeScript type checking
npm run lint                 # Lint all packages

# Infrastructure
cd packages/infrastructure
npm run synth                # Generate CloudFormation templates
npm run deploy:dev           # Deploy to development
npm run deploy:staging       # Deploy to staging
npm run deploy:prod          # Deploy to production
npm run destroy              # Destroy infrastructure

# Database
npm run init-db:dev          # Initialize development database
npm run init-db:staging      # Initialize staging database
npm run init-db:prod         # Initialize production database

# Development
npm run dev                  # Watch mode compilation
npm run clean               # Clean all build outputs
```

## Troubleshooting

### Common Issues

1. **CDK Bootstrap Required**
   ```bash
   cdk bootstrap aws://ACCOUNT-ID/REGION
   ```

2. **Environment Variables Missing**
   - Ensure `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` are set
   - Check `.env` file is properly configured

3. **Database Connection Issues**
   - Verify RDS is running and accessible
   - Check security group rules allow Lambda → RDS on port 5432
   - Ensure Secrets Manager contains valid credentials

4. **Lambda Function Errors**
   - Check CloudWatch logs for detailed error messages
   - Verify IAM permissions are correctly configured
   - Test database initialization: `npm run init-db:dev`

5. **Slack Integration Issues**
   - Verify webhook URL is correct in Slack app settings
   - Check API Gateway logs for request/response details
   - Ensure Slack app has required OAuth scopes

### Monitoring

- **CloudWatch Logs**: Monitor Lambda function logs
- **API Gateway**: Track request/response metrics
- **RDS Performance Insights**: Database performance monitoring
- **AWS X-Ray**: Distributed tracing (if enabled)

## Security

- **Database credentials**: Stored in AWS Secrets Manager
- **VPC isolation**: Database in private subnets only
- **IAM permissions**: Principle of least privilege
- **Environment separation**: Separate stacks per environment

## Support

For issues with deployment or configuration, check:
1. AWS CloudFormation console for stack events
2. Lambda function logs in CloudWatch
3. API Gateway execution logs
4. RDS connectivity and performance metrics