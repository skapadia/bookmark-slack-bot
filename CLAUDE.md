# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Root-level Commands
```bash
# Build all packages
npm run build

# Run all tests (Vitest)
npm run test
npm run test:integration
npm run test:e2e

# Type checking across all packages  
npm run type-check

# Linting across all packages
npm run lint

# Development with watch mode
npm run dev

# Build verification (recommended before deployment)
npm run verify-build

# Database initialization
npm run init-db:dev
npm run init-db:staging  
npm run init-db:prod
```

### Package-specific Commands
Each package (`core`, `shared`, `lambda-public`, `lambda-private`, `infrastructure`) supports:
```bash
cd packages/<package-name>
npm run build          # TypeScript compilation
npm run dev            # Watch mode compilation
npm run test           # Vitest tests
npm run lint           # ESLint
npm run type-check     # TypeScript checking
```

### Infrastructure/Deployment Commands
```bash
cd packages/infrastructure
npm run synth          # Generate CloudFormation
npm run deploy:dev     # Deploy development
npm run deploy:prod    # Deploy production  
npm run bootstrap      # CDK bootstrap (first time)
npm run destroy        # Destroy infrastructure
```

## Architecture Overview

### Dual Lambda Pattern
- **Public Lambda** (`lambda-public`): Handles Slack events, web scraping, AI tag generation (outside VPC)
- **Private Lambda** (`lambda-private`): Database operations only (inside VPC with RDS access)

### Package Structure & Dependencies (Clean Architecture)
```
shared/                    # Pure domain types & utilities
├── types/                 # Domain entities (Bookmark, BookmarkMetadata)
├── utils/                 # Validation, logging, error handling  
├── config/                # Environment configuration
└── errors/                # Custom error classes

api-contracts/             # All API interface contracts
└── lambda/                # Lambda operations, payloads, request/response types
    # Future: REST, GraphQL contracts would go here

core/                      # Pure business logic (no external dependencies)
├── interfaces/            # Repository, AI, and metadata interfaces
└── services/              # BookmarkService orchestrates all operations

lambda-public/             # Slack handler + external service implementations
├── handlers/              # Slack event/command handlers
└── implementations/       # Bedrock AI, web scraping, Lambda repository proxy

lambda-private/            # Database handler + PostgreSQL implementation  
├── handlers/              # Lambda function entry point for DB operations
└── implementations/       # PostgreSQL repository implementation

infrastructure/            # AWS CDK deployment code
└── src/                   # VPC, RDS, Lambda, API Gateway, Secrets Manager
```

### Key Architectural Patterns

**Clean Architecture**: `core` contains pure business logic with dependency injection via interfaces. Infrastructure concerns are isolated in implementation packages.

**Repository Pattern**: All database operations go through `BookmarkRepository` interface:
- `PostgresBookmarkRepository` (lambda-private): Direct database access
- `LambdaBookmarkRepository` (lambda-public): Proxies to private Lambda

**Service Layer**: `BookmarkService` orchestrates metadata extraction, AI tag generation, and persistence using injected dependencies.

**Lambda Communication**: Public Lambda invokes Private Lambda for all database operations via AWS Lambda invoke API.

### Technology Stack
- **Language**: TypeScript 5+ with ES modules
- **Testing**: Vitest with coverage reporting
- **Slack**: @slack/bolt SDK 
- **AI**: AWS Bedrock (Claude 3 Haiku)
- **Database**: PostgreSQL via RDS
- **Infrastructure**: AWS CDK
- **Monorepo**: npm workspaces (fixed from pnpm workspace protocol)

### Known Issues & Fixes Applied
**Workspace Protocol Fix**: The project originally used `workspace:*` syntax (pnpm-specific) which caused `EUNSUPPORTEDPROTOCOL` errors with npm. Fixed by changing all workspace dependencies to use `*` syntax instead.

**Current TypeScript Issues**: After workspace fix, there are TypeScript compilation errors mainly related to:
- Import path resolution for workspace packages
- CDK type compatibility issues
- Missing type declarations

### Environment Configuration
All packages read from environment variables defined in `.env`. Key variables include:
- Database: `DATABASE_*` credentials
- AWS: `AWS_REGION`, `BEDROCK_MODEL_ID`, `LAMBDA_*_NAME` 
- Slack: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`

### Testing Strategy
- Unit tests in each package using Vitest
- Integration tests in `/tests/integration/` 
- E2E tests in `/tests/e2e/`
- Run `npm run test` from root to execute all tests

### CI/CD Pipeline
**GitHub Actions Workflows**:
- `ci.yml`: Runs on PRs and pushes - type checking, linting, testing, security audit
- `deploy.yml`: Deploys infrastructure based on branch (main→production, staging→staging, develop→development)

**Branch Strategy**:
- `main`: Production deployments
- `staging`: Staging environment 
- `develop`: Development environment
- Feature branches: Create PRs to `develop`

**Required Secrets & Variables**:
- `AWS_ROLE_ARN`: IAM role for OIDC authentication
- `SLACK_BOT_TOKEN`: Slack app bot token
- `SLACK_SIGNING_SECRET`: Slack app signing secret  
- `AWS_REGION` (variable): Deployment region
- `BEDROCK_MODEL_ID` (variable): AI model identifier

### Common Development Workflows
1. **Adding new features**: Start in `core/interfaces`, implement in `core/services`, add implementations in Lambda packages
2. **Database changes**: Modify `PostgresBookmarkRepository`, update Lambda invoke operations
3. **New Slack commands**: Add handlers in `lambda-public/handlers/slack-handler.ts`
4. **AI improvements**: Modify `BedrockTagGenerator` implementation
5. **Deployments**: Push to `develop`, `staging`, or `main` branches for automatic deployment

### Important Implementation Details
- All packages use ES modules (`"type": "module"`)
- File extensions required in imports (`.js` for compiled output)
- Private Lambda runs in VPC with RDS access but no internet
- Public Lambda has internet access but cannot directly access RDS
- Database credentials stored in AWS Secrets Manager
- All logging uses structured logging via shared logger utility