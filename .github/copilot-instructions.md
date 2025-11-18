# LanguageBuddy AI Agent Instructions

## Project Overview
WhatsApp-based language learning service using LangGraph agents, Redis for state persistence, and OpenAI GPT-4. Users learn languages through conversational practice with an AI tutor that maintains persistent conversation history and subscriber profiles.

## Issue Tracking and Todos
If there are todos add them to the todos.md file in the project root. There you can also find all the current other todos.
Should you notice that another todo is related to the current task and killing two birds with one stone is smart work on that other todo as well. When you finish a todo, please indicate that in the end so I can delete it after manual testing. 

## Architecture

### Core Components
- **LangGraph Agent** (`language-buddy-agent.ts`): Stateful conversational AI using `createReactAgent()` with custom tools and Redis checkpoint persistence
- **ServiceContainer** (`service-container.ts`): Dependency injection pattern - initializes all services in specific order, used throughout app
- **Redis State**: Two storage patterns:
  - `checkpoint:${phone}` - LangGraph conversation state (managed by `RedisCheckpointSaver`)
  - `subscriber:phone:${phone}` - User profiles with language assessments (`SubscriberService`)
  - `onboarding:${phone}` - Temporary onboarding state (`OnboardingService`)
- **WhatsApp Integration**: Via `whatsapp-cloud-api-express` + custom `WhatsAppService` with CLI fallback mode

### Data Flow
1. WhatsApp webhook → `webhook-service.ts` → deduplication check → user command parsing
2. If onboarding: `OnboardingService` manages state machine
3. If normal chat: `LanguageBuddyAgent.processUserMessage()` → LangGraph with tools
4. Response → `WhatsAppService` → markdown formatting → WhatsApp Cloud API (or CLI)

### Key Patterns
- **Singleton Services**: All services use `getInstance(redis?)` pattern - Redis instance required on first call
- **Phone as Thread ID**: User's phone number is the LangGraph `thread_id` (configurable parameter)
- **System Prompts**: Generated dynamically based on user state in `system-prompts.ts` - onboarding vs regular vs specific language levels
- **Tools**: Defined in `tools/` directory, registered in tools array, accessible to LangGraph agent via `@langchain/core/tools`

## Development Workflow

### Local Development with CLI
```bash
cd backend
npm install
npm run dev:cli  # Backend with USE_LOCAL_CLI_ENDPOINT
npm run cli      # In separate terminal - simulates WhatsApp
```
CLI mode sends responses to localhost instead of WhatsApp API - crucial for testing without live API.

### Building & Testing
```bash
npm run build           # SWC compilation to dist/
npm run type-check      # TypeScript validation (no emit)
npm test                # Jest unit tests (fast, <2s - run on every save)
npm run test:watch      # Watch mode for unit tests during development
npm run test:e2e        # Real Redis + OpenAI integration tests (RUN_E2E_TESTS=true)
```

**Testing Philosophy**:
- **Unit tests**: Fast (<2s total), no external dependencies, run on every save. Mock Redis and LLM calls.
- **Integration tests**: Test service interactions with real Redis, but mock LLM. Use for throttling/subscription logic.
- **E2E tests**: Real Redis + OpenAI calls (expensive!). Only run when touching core conversation flows.

**CRITICAL TEST GAPS** - these areas need more coverage:
- ⚠️ **Throttling logic** in `SubscriberService` - `shouldThrottle()`, `canStartConversationToday()` have edge cases
- ⚠️ **Stripe integration** in `StripeService` - payment flows, webhook handling, subscription checks are fragile
- ⚠️ **Trial period transitions** - Day 7 cutoff logic needs comprehensive tests
- ⚠️ **Conversation count tracking** - Redis key expiration and increment logic needs validation

### Deployment (Nix)
```bash
just deploy-prod   # From root: interactive commit picker → Nix build → rsync → systemd restart
just deploy-test   # Test environment deployment
```
Deployment uses Nix flake (`flake.nix`) which builds backend via `backend/flake.nix`. `.env.prod` is backed up and restored during deployment.

## Configuration

### Environment Variables
Required in `.env` (see `config/index.ts` for full list):
- `OPENAI_API_KEY`, `OPENAI_MODEL_NAME`
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`
- `STRIPE_SECRET_KEY`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `TEMPO_ENDPOINT` or `OTLP_ENDPOINT` (observability)
- `USE_LOCAL_CLI_ENDPOINT=http://localhost:3333/cli-response` (CLI mode)

### Observability & Debugging
- **Tracing**: OpenTelemetry auto-instrumentation initialized in `main.ts` BEFORE other imports (critical!)
- **Logging**: Pino with trace context injection via mixin in `config/index.ts`
- **Redis Inspection**:
  - `just checkpoint <phone>` - View LangGraph conversation state
  - `sh backend/redis-connect.sh` - Connect to Redis CLI for manual exploration
  - Key patterns: `checkpoint:*`, `subscriber:phone:*`, `onboarding:*`, `conversation_count:*`
- **Manual Testing**: CLI mode is essential - chat extensively with your language buddy to verify conversation flow and UX

## Subscriber Model
See `types/index.ts` for full schema. Key fields:
- `profile.name`, `profile.nativeLanguages[]`, `profile.timezone`
- `languages: Language[]` - array of learning languages with CEFR levels, skill assessments, deficiencies
- `isPremium`, `signedUpAt` - subscription/trial logic
- `dailyMessageSettings` - notification windows

### Subscriber Tools
Located in `tools/subscriber-tools.ts` - available to LangGraph agent:
- `get_subscriber_profile` - Read user data
- `update_subscriber_profile` - Persist changes
- `add_language_deficiency` - Track learning gaps
These are the ONLY way agent should access subscriber data.

## Important Conventions

### Message Formatting
- Use `markdownToWhatsApp()` from `message-formatters.ts` to convert LLM markdown to WhatsApp format
- Multi-part messages use separator `---8<---` (split by `splitMessageBySeparator()`)

### Onboarding State Machine
Complex multi-step flow in `OnboardingService` - do NOT modify lightly:
1. GDPR consent check
2. Profile collection (name, native languages, timezone)
3. Target language selection
4. Feature explanation + assessment
5. Language level assessment conversation (10 exchanges)
6. Create subscriber profile with initial assessment

See `util/system-prompts.ts` for detailed onboarding prompt logic.

### User Commands
Prefixed with `!` or detected patterns in `user-commands.ts`:
- `!clear` - Reset conversation history
- `!digest` - Manual conversation digest creation
- `ping` - Health check

### Throttling & Premium
- Trial users: 7 days unlimited, then 1 premium conversation/day
    - premium conversation is e.g. quizzes or targeted practice. Just chatting is always free.
- Logic in `SubscriberService`: `shouldThrottle()`, `canStartConversationToday()`
- Stripe integration in `StripeService`

## Testing Patterns

### Test Categories
1. **Unit Tests** (`.test.ts`) - No external dependencies, mock everything
   - Use in-memory Redis mock or stub service methods
   - Mock LLM responses with fixed strings
   - Focus on business logic, edge cases, validation
   - Target: <2 seconds total execution time
   
2. **Integration Tests** (`.integration.test.ts`) - Real Redis, mocked LLM
   - Use real Redis instance (local or test container)
   - Mock OpenAI/LangGraph responses to avoid costs
   - Test service interactions, state persistence, cache behavior
   - Focus on throttling, subscription logic, conversation counting
   
3. **E2E Tests** (`.e2e.test.ts`) - Real everything
   - Real Redis + real OpenAI LLM calls (expensive!)
   - Use `OnboardingTestHelper` class pattern for multi-step flows
   - Clean up test data: `redis.del()` in afterEach
   - Only run when touching core conversation flows

### Test Utilities Needed
- **Redis test helpers**: Fixtures for creating test subscribers, clearing state, inspecting keys
- **LLM mocks**: Reusable mock responses for common scenarios (onboarding, assessments, etc.)
- **Time helpers**: Mock `DateTime.now()` to test trial period transitions
- **Stripe mocks**: Mock webhook payloads and subscription responses

### Testing Pain Points
- ⚠️ **Redis state manipulation** - No easy way to set up complex test scenarios in Redis
- ⚠️ **Conversation testing** - Must chat extensively via CLI to verify UX/flow
- ⚠️ **Throttling edge cases** - Day boundaries, timezone handling, Redis key expiration timing
- ⚠️ **Stripe webhooks** - Hard to test payment flows without real Stripe events

## Common Tasks

**Add new LangGraph tool**: Create in `tools/`, add to tools array in `tools/index.ts`, use zod for schema

**Change conversation logic**: Modify agent behavior in `language-buddy-agent.ts` or system prompt in `system-prompts.ts`

**Add new subscriber field**: Update `types/index.ts` Subscriber interface, ensure Redis serialization works

**Debug conversation state**: `just checkpoint <phone>` or `sh backend/redis-connect.sh` for manual Redis exploration

**Test without WhatsApp**: Always use CLI mode locally - never connect dev to production WhatsApp webhook

**Write tests for new features**:
1. Start with fast unit tests (<2s) - mock Redis and LLM
2. Add integration tests if touching throttling/subscription/state logic
3. Only add E2E tests for core conversation flows (expensive!)
4. Use test file naming: `*.test.ts` (unit), `*.integration.test.ts`, `*.e2e.test.ts`

**Manually test conversation flow**: Use CLI mode and chat extensively to verify UX feels right

## Known Buggy Areas - Write Tests First!

These areas have recurring bugs and need comprehensive test coverage before making changes:

1. **Throttling Logic** (`SubscriberService.shouldThrottle()`, `canStartConversationToday()`)
   - Trial period day counting (7-day cutoff)
   - Timezone handling for day boundaries
   - Redis key expiration for `conversation_count:*` keys
   - Edge cases: exactly 7 days, multiple conversations per day

2. **Stripe Integration** (`StripeService`)
   - Payment link generation
   - Subscription status checks
   - Webhook handling for payment events
   - Premium flag updates after payment

3. **Conversation Count Tracking**
   - Daily increment logic with Redis expiration
   - Counting across timezone boundaries
   - Race conditions on concurrent messages

4. **Trial Period Transitions**
   - Behavior at day 3-6 (warning messages)
   - Hard cutoff at day 7 (throttling starts)
   - Premium upgrade during trial

When modifying these areas: **write integration tests first** to capture current behavior and edge cases.
