# Bookmark Slack Bot

A sophisticated Slack bot for bookmarking URLs with AI-powered tag generation, featuring dual Lambda architecture for optimal performance and security.

## Features

- 🤖 **AI-Powered Tagging**: Uses AWS Bedrock (Claude 3 Haiku) for intelligent tag generation
- ⚡ **Async Processing**: Handles Slack's 3-second timeout constraint with background processing
- 🔍 **Smart Tag Matching**: Fuzzy matching and grammatical variation detection for existing tags
- 🏗️ **Clean Architecture**: Separation of concerns with dependency injection
- 🔐 **Secure**: Private Lambda in VPC for database access, public Lambda for internet services
- 📊 **Comprehensive Logging**: Structured logging throughout the application
- 🚀 **CI/CD Ready**: GitHub Actions workflows for automated testing and deployment

## Architecture

- **Dual Lambda**: Public Lambda handles Slack events, Private Lambda handles database operations
- **TypeScript Monorepo**: npm workspaces with multiple packages
- **Clean Architecture**: Business logic separated from infrastructure concerns

## Project Structure

```
packages/
├── shared/           # Shared types, utilities, configuration
├── api-contracts/    # Lambda operation types and request/response contracts
├── core/             # Business logic and interfaces (no external deps)
├── lambda-public/    # Slack event handling + Bedrock integration
├── lambda-private/   # Database operations
└── infrastructure/   # AWS CDK deployment code
```

### Package Descriptions

- **shared**: Core domain types, validation, logging, configuration utilities
- **api-contracts**: Type-safe contracts for Lambda-to-Lambda communication
- **core**: Pure business logic (BookmarkService) with dependency injection interfaces
- **lambda-public**: Internet-facing Lambda (Slack webhooks, web scraping, AI tagging)
- **lambda-private**: VPC-based Lambda (PostgreSQL database operations)  
- **infrastructure**: AWS CDK stack with dual Lambda + RDS deployment

## Development

### Prerequisites

- Node.js 20+
- npm 10+
- AWS CLI configured
- PostgreSQL database

### Setup

```bash
# Install dependencies
npm install

# Type check all packages
npm run type-check

# Build all packages
npm run build

# Run tests
npm run test

# Run tests in watch mode
npm run test:watch
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_PROFILE=your-aws-profile

# Bedrock Configuration  
BEDROCK_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret

# Lambda Function Name (for scripts only)
LAMBDA_PRIVATE_NAME=bookmark-bot-private-development
```

**Note**: Database configuration is handled automatically via AWS Secrets Manager in the deployed environment. No manual database setup is required.

### Package Scripts

Each package supports:
- `npm run build` - TypeScript compilation
- `npm run dev` - Watch mode compilation  
- `npm run test` - Run tests
- `npm run lint` - ESLint
- `npm run type-check` - TypeScript type checking

### Deployment

```bash
# Deploy to development
cd packages/infrastructure
npm run deploy:dev

# Deploy to staging
npm run deploy:staging

# Deploy to production  
npm run deploy:prod

# Initialize database schema
cd ../..
npm run init-db:dev
```

### Database Operations

```bash
# Initialize database schema (development)
npm run init-db:dev

# Initialize database schema (staging)
npm run init-db:staging

# Initialize database schema (production)
npm run init-db:prod
```

## Architecture Migration

📋 **Current Status**: The project includes a comprehensive migration plan in `LAMBDA_MIGRATION_PLAN.md` to consolidate business logic into the private Lambda for better performance and reduced coupling.

**Benefits of planned migration**:
- Single Lambda call instead of 3-4 calls (~500ms improvement)
- Reduced network overhead and improved reliability
- Centralized business logic in private Lambda
- Simplified error handling and transaction boundaries

## Testing

- **Unit Tests**: Vitest with coverage reporting
- **Integration Tests**: Test with real AWS services in development
- **CI/CD**: GitHub Actions for automated testing and deployment

## Contributing

1. Create feature branch from `develop`
2. Make changes with tests
3. Ensure CI passes
4. Create pull request to `develop`

## License

MIT