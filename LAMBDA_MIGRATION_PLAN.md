# Lambda Architecture Migration Plan
## From Multi-Call to Single-Call Pattern

**Objective**: Consolidate business logic into private Lambda to eliminate multiple inter-Lambda calls and improve performance.

---

## 🎯 Current Architecture Issues

### Performance Problems
- **Multiple Private Lambda Calls**: Each bookmark creation makes 3-4 calls:
  1. `findByUrl()` - Check if bookmark exists (~150ms)
  2. `getSeedTags()` - Get existing tags for AI (~200ms) 
  3. `getExistingTags()` - Get team tags for matching (~200ms)
  4. `save()` - Save final bookmark (~150ms)
- **Total Latency**: ~700ms just in Lambda calls + network overhead
- **Cold Start Multiplication**: Each call can trigger private Lambda cold starts

### Architectural Issues
- **Tight Coupling**: Public Lambda knows private Lambda's internal API
- **Business Logic Split**: Tag generation logic scattered across both Lambdas
- **Complex Error Handling**: Network failures between Lambdas
- **Transaction Boundaries**: No atomic database operations

---

## 🏗️ Target Architecture

### Public Lambda (Internet-Facing)
```
┌─────────────────────────────────────┐
│ Responsibilities:                   │
│ • Slack webhook handling           │
│ • Web metadata extraction          │
│ • Single call to private Lambda   │
│ • Response formatting              │
├─────────────────────────────────────┤
│ Dependencies:                      │
│ • @slack/bolt                      │
│ • node-fetch                       │
│ • @aws-sdk/client-lambda           │
└─────────────────────────────────────┘
```

### Private Lambda (VPC/Database)
```
┌─────────────────────────────────────┐
│ Responsibilities:                   │
│ • All business logic               │
│ • AI tag generation                │
│ • Database operations              │
│ • Complete bookmark processing     │
├─────────────────────────────────────┤
│ Dependencies:                      │
│ • @aws-sdk/client-bedrock-runtime  │
│ • pg (PostgreSQL)                  │
│ • fuzzball                         │
│ • wink-lemmatizer                  │
│ • All business logic packages      │
└─────────────────────────────────────┘
```

---

## 📋 Migration Steps

### Phase 1: Infrastructure Preparation
**Estimated Time**: 30 minutes

#### 1.1 Add Bedrock VPC Endpoint
```typescript
// In packages/infrastructure/src/bookmark-stack.ts
this.vpc.addInterfaceEndpoint('BedrockVpcEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
  subnets: {
    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
  },
  securityGroups: [this.privateLambdaSG],
});
```

#### 1.2 Update Private Lambda IAM Permissions
```typescript
// Add Bedrock permissions to private Lambda
this.privateLambda.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: [`arn:aws:bedrock:${this.region}::foundation-model/${bedrockModelId}`]
}));
```

#### 1.3 Update Private Lambda Memory & Timeout
```typescript
memorySize: 1024, // Increase for AI processing
timeout: cdk.Duration.seconds(45), // Increase for AI calls
```

### Phase 2: Create New API Contract
**Estimated Time**: 20 minutes

#### 2.1 Add New Operation Type
```typescript
// In packages/api-contracts/src/lambda/index.ts
export type PrivateLambdaOperation = 
  | 'saveBookmark'
  | 'findByUrl'
  | 'getSeedTags' 
  | 'searchBookmarks'
  | 'deleteBookmark'
  | 'initializeSchema'
  | 'getRecentBookmarks'
  | 'getExistingTags'
  | 'getPopularTags'
  | 'createBookmarkComplete'; // NEW: Complete bookmark creation
```

#### 2.2 Add Complete Bookmark Payload
```typescript
export interface CreateBookmarkCompletePayload {
  url: string;
  title: string;
  description: string;
  userId: string;
  teamId: string;
  channelId: string;
  manualTags?: string[];
}
```

### Phase 3: Move Dependencies to Private Lambda  
**Estimated Time**: 15 minutes

#### 3.1 Update Private Lambda package.json
```json
{
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.490.0",
    "@bookmark-slack-bot/shared": "*",
    "@bookmark-slack-bot/core": "*", 
    "@bookmark-slack-bot/api-contracts": "*",
    "pg": "^8.11.0",
    "fuzzball": "^2.1.2",
    "wink-lemmatizer": "^3.0.4"
  }
}
```

### Phase 4: Move Business Logic to Private Lambda
**Estimated Time**: 45 minutes

#### 4.1 Create Private Lambda Implementation Classes
```
packages/lambda-private/src/implementations/
├── sophisticated-bedrock-tag-generator.ts    # Move from public
├── postgres-bookmark-repository.ts           # Already exists
└── complete-bookmark-service.ts              # New service
```

#### 4.2 Move SophisticatedBedrockTagGenerator
- Copy `sophisticated-bedrock-tag-generator.ts` from public to private
- Update imports to use local PostgresBookmarkRepository
- Remove LambdaBookmarkRepository proxy logic

#### 4.3 Create CompleteBookmarkService
```typescript
export class CompleteBookmarkService {
  constructor(
    private bookmarkRepository: PostgresBookmarkRepository,
    private tagGenerator: SophisticatedBedrockTagGenerator
  ) {}
  
  async createBookmarkComplete(payload: CreateBookmarkCompletePayload): Promise<Bookmark> {
    // All the logic currently in BookmarkService.createBookmark()
    // but using direct database access instead of Lambda calls
  }
}
```

#### 4.4 Update Private Lambda Handler
```typescript
// Add new case in database-handler.ts
case 'createBookmarkComplete': {
  const service = new CompleteBookmarkService(repository, tagGenerator);
  const result = await service.createBookmarkComplete(request.payload);
  return { success: true, data: result };
}
```

### Phase 5: Update Public Lambda
**Estimated Time**: 30 minutes

#### 5.1 Simplify Public Lambda Dependencies
```json
{
  "dependencies": {
    "@aws-sdk/client-lambda": "^3.490.0",
    "@bookmark-slack-bot/api-contracts": "*",
    "@bookmark-slack-bot/shared": "*", 
    "@slack/bolt": "^3.17.0",
    "node-fetch": "^3.3.0"
  }
}
```

#### 5.2 Update Async Processing Function
```typescript
// In slack-handler.ts processBookmarkAsync()
async function processBookmarkAsync(event: AsyncBookmarkEvent): Promise<void> {
  // Extract metadata (keep this in public Lambda)
  const metadata = await metadataExtractor.extractMetadata(url);
  
  // Single call to private Lambda with complete data
  const createBookmarkPayload: CreateBookmarkCompletePayload = {
    url: command.url,
    title: metadata.title,
    description: metadata.description,
    userId: command.user_id,
    teamId: command.team_id, 
    channelId: command.channel_id,
    manualTags: command.manualTags
  };
  
  const bookmark = await privateLambdaClient.invoke('createBookmarkComplete', createBookmarkPayload);
  
  // Send result back to Slack
  await sendSlackResponse(command.response_url, bookmark);
}
```

### Phase 6: Deployment & Testing
**Estimated Time**: 30 minutes

#### 6.1 Deploy Infrastructure Changes
```bash
cd packages/infrastructure
npm run deploy:dev -- --require-approval never
```

#### 6.2 Test Database Operations
```bash
npm run init-db:dev
```

#### 6.3 Test End-to-End Flow
- Test `/bookmark` command with simple URL
- Test with manual tags
- Test with existing tag matching
- Verify single private Lambda call in logs

### Phase 7: Cleanup (Optional)
**Estimated Time**: 15 minutes

#### 7.1 Remove Unused Dependencies from Public
- Remove `@aws-sdk/client-bedrock-runtime`
- Remove `fuzzball` 
- Remove `wink-lemmatizer`

#### 7.2 Remove Unused Private Lambda Operations
- Remove individual operations if no longer needed
- Keep them for now for other potential use cases

---

## 🚀 Expected Performance Improvements

### Before Migration
```
Slack Command → Public Lambda (100ms)
├── Web Scraping (1000ms)
├── findByUrl() → Private Lambda (150ms)
├── getSeedTags() → Private Lambda (200ms) 
├── getExistingTags() → Private Lambda (200ms)
├── AI Tag Generation (3000ms)
└── save() → Private Lambda (150ms)
Total: ~4800ms
```

### After Migration  
```
Slack Command → Public Lambda (100ms)
├── Web Scraping (1000ms)
└── createBookmarkComplete() → Private Lambda (3200ms)
    ├── All database operations (local)
    ├── AI Tag Generation (via VPC endpoint)
    └── Single response
Total: ~4300ms (10% improvement)
```

### Network Call Reduction
- **Before**: 4 inter-Lambda calls 
- **After**: 1 inter-Lambda call
- **Latency Saved**: ~500ms from eliminated network overhead
- **Reliability**: Single point of failure vs 4 potential failure points

---

## 🔒 Risk Mitigation

### Rollback Strategy
1. Keep old API operations in private Lambda during migration
2. Feature flag to switch between old and new flows
3. Database operations are backward compatible

### Testing Strategy  
1. Unit tests for new CompleteBookmarkService
2. Integration tests with test database
3. End-to-end tests with Slack webhook simulation
4. Performance benchmarking before/after

### Deployment Strategy
1. Deploy infrastructure changes first (VPC endpoint)
2. Deploy private Lambda with new logic (backward compatible)
3. Deploy public Lambda with new call pattern
4. Monitor and rollback if issues detected

---

## 📊 Success Metrics

### Performance Targets
- [ ] **Total bookmark creation time**: < 4000ms (from ~4800ms)
- [ ] **Inter-Lambda calls**: 1 (from 3-4)  
- [ ] **Error rate**: < 1% (from current ~2%)
- [ ] **Cold start impact**: Reduced frequency

### Architecture Quality
- [ ] **Business logic centralization**: All in private Lambda
- [ ] **Reduced coupling**: Public only knows single API endpoint
- [ ] **Error handling**: Simplified with single transaction boundary
- [ ] **Maintainability**: Clear separation of concerns

---

## 🎯 Timeline Summary

| Phase | Task | Duration | Dependencies |
|-------|------|----------|--------------|
| 1 | Infrastructure Setup | 30 min | CDK changes |
| 2 | API Contract Updates | 20 min | Type definitions |  
| 3 | Move Dependencies | 15 min | Package.json |
| 4 | Move Business Logic | 45 min | Code migration |
| 5 | Update Public Lambda | 30 min | Phase 4 complete |
| 6 | Deploy & Test | 30 min | All phases |
| 7 | Cleanup | 15 min | Optional |

**Total Estimated Time**: ~3 hours

**Recommended Approach**: Execute in phases with testing between each phase to ensure stability.