# Bookmark Slack Bot

A dual Lambda architecture Slack bot for bookmarking URLs with AI-powered tag generation.

## Architecture

- **Dual Lambda**: Public Lambda handles Slack events, Private Lambda handles database operations
- **TypeScript Monorepo**: npm workspaces with multiple packages
- **Clean Architecture**: Business logic separated from infrastructure concerns

## Project Structure

```
packages/
├── shared/           # Shared types, utilities, configuration
├── core/             # Business logic and interfaces (no external deps)
├── lambda-public/    # Slack event handling + Bedrock integration
├── lambda-private/   # Database operations
└── infrastructure/   # AWS CDK deployment code
```

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
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=bookmarks
DATABASE_USER=your_user
DATABASE_PASSWORD=your_password

# AWS
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0

# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret

# Lambda Function Names
LAMBDA_PUBLIC_NAME=bookmark-bot-public
LAMBDA_PRIVATE_NAME=bookmark-bot-private
```

### Package Scripts

Each package supports:
- `npm run build` - TypeScript compilation
- `npm run dev` - Watch mode compilation  
- `npm run test` - Run tests
- `npm run lint` - ESLint
- `npm run type-check` - TypeScript type checking

### Deployment

```bash
# Deploy infrastructure
cd packages/infrastructure
npm run deploy

# Deploy individual Lambda functions
# (handled by CDK deployment)
```

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