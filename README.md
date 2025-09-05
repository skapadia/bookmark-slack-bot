# Bookmark Slack Bot

A Slack bot for bookmarking URLs with AI-powered tag generation, featuring a dual Lambda architecture for performance and security.

## Features

- 🤖 **AI-Powered Tagging**: Uses AWS Bedrock (Claude 3 Haiku) with multi-stage tag generation including existing tag matching, specificity filtering, and hybrid scoring
- ⚡ **Single-Call Architecture**: Reduced from 3-4 Lambda calls to 1 call per bookmark creation
- 🔍 **Intelligent Tag Matching**: Fuzzy matching, grammatical variation detection (singular/plural, verb forms), and contextual keyword scoring
- 🔗 **Smart Web Scraping**: Extracts metadata from URLs with fallback handling and size limits
- 🏗️ **Clean Architecture**: Separation of concerns with dependency injection and interface segregation
- 🔐 **Secure VPC Design**: Private Lambda in VPC with Bedrock VPC endpoint for secure AI access
- 📊 **Comprehensive Logging**: Structured logging with request tracing throughout the application
- 🚀 **Production Ready**: GitHub Actions CI/CD with automated testing, linting, and multi-environment deployment

## Architecture

- **Dual Lambda Pattern**: Public Lambda handles external services (Slack, web scraping), private Lambda handles database operations and AI processing
- **TypeScript Monorepo**: npm workspaces with clean dependency management and project references
- **AWS Services**: VPC endpoints, Secrets Manager, RDS PostgreSQL, and Lambda functions with proper IAM roles

## Project Structure

```
packages/
├── shared/           # Domain types, utilities, configuration, error handling
├── api-contracts/    # Type-safe Lambda operation contracts and payload interfaces
├── core/             # Pure business logic interfaces (no external dependencies)
├── lambda-public/    # Slack webhooks and web metadata extraction
├── lambda-private/   # Database operations and AI tag generation via Bedrock
└── infrastructure/   # AWS CDK deployment with VPC, RDS, Lambda configuration
```

### Package Descriptions

- **shared**: Core domain types (Bookmark, Metadata), validation utilities, structured logging, and environment configuration
- **api-contracts**: Type-safe contracts for Lambda-to-Lambda communication with operation types and request/response interfaces
- **core**: Pure business logic interfaces (BookmarkRepository, TagGenerator, MetadataExtractor) with dependency injection
- **lambda-public**: Internet-facing Lambda handling Slack events, web scraping, and async bookmark processing
- **lambda-private**: VPC-based Lambda with direct database access, AI tag generation, and consolidated business logic
- **infrastructure**: AWS CDK stack deploying VPC, RDS PostgreSQL, dual Lambda functions, VPC endpoints, and IAM roles

## Development

### Prerequisites

- Node.js 20+
- npm 10+
- AWS CLI configured with appropriate IAM permissions
- Slack workspace for app installation

### Setup

```bash
# Clone and install dependencies
git clone <repository-url>
cd bookmark-slack-bot
npm install

# Build all packages (with proper dependency order)
npm run build

# Type check all packages
npm run type-check

# Run tests
npm run test

# Run tests with coverage
npm run test -- --coverage

# Lint all packages
npm run lint
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

### Slack App Setup

1. Create a Slack app at https://api.slack.com/apps
2. Configure the following scopes in OAuth & Permissions:
   - `chat:write` - Send messages
   - `commands` - Add slash commands
   - `app_mentions:read` - Read app mentions
3. Add slash commands:
   - `/bookmark` - Request URL: `https://your-api-gateway-url/slack/events`
   - `/bookmarks` - Request URL: `https://your-api-gateway-url/slack/events`  
   - `/bookmark-help` - Request URL: `https://your-api-gateway-url/slack/events`
4. Enable Event Subscriptions with Request URL: `https://your-api-gateway-url/slack/events`
5. Subscribe to `app_mention` events
6. Install the app to your workspace and copy the tokens to `.env`

### Deployment

```bash
# Deploy to development environment
cd packages/infrastructure
npm run deploy:dev

# Deploy to staging environment  
npm run deploy:staging

# Deploy to production environment
npm run deploy:prod

# Initialize database schema (after deployment)
cd ../..
npm run init-db:dev    # for development
npm run init-db:staging # for staging
npm run init-db:prod   # for production
```

### Database Operations

The database schema is automatically initialized when you run the init commands above. The system uses PostgreSQL via AWS RDS with automated backups, security groups, and proper VPC isolation.

## Usage

### Slack Commands

- `/bookmark <URL>` - Save a bookmark with AI-generated tags
- `/bookmark <URL> tag1 tag2` - Save a bookmark with manual tags (combined with AI tags)
- `/bookmarks` - Show your recent bookmarks  
- `/bookmarks search term` - Search your bookmarks by title, description, tags, or URL
- `/bookmark-help` - Display help information

### Example Usage

```
/bookmark https://docs.aws.amazon.com/lambda/
/bookmark https://react.dev/ react javascript frontend tutorial
/bookmarks react
/bookmarks AWS Lambda performance
```

## Testing

- **Unit Tests**: Vitest with coverage reporting across all packages
- **Integration Tests**: Real AWS service testing in development environment
- **End-to-End Tests**: Full workflow testing with Slack integration
- **CI/CD Pipeline**: GitHub Actions with automated testing, linting, type checking, and security audits

```bash
# Run all tests
npm run test

# Run tests with coverage
npm run test -- --coverage

# Run integration tests
npm run test:integration

# Run end-to-end tests  
npm run test:e2e
```

## Contributing

1. Create feature branch from `main`
2. Make changes with comprehensive tests
3. Ensure all CI checks pass (build, test, lint, type-check)
4. Create pull request to `main`
5. Code review and merge

### Branch Strategy
- `main` - Production deployments
- `staging` - Staging environment (optional)
- `develop` - Development environment (optional)
- `feature/*` - Feature development branches

## License

MIT