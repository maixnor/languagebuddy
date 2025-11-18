# Bug-Hunting Test Suite Documentation

This document describes the comprehensive test suite created to find bugs in the throttling logic and Stripe integration. **These tests are designed to FIND bugs, not fix them yet.**

## Test Files Created

1. `throttling-logic.integration.test.ts` - Throttling and trial period logic
2. `stripe-integration.integration.test.ts` - Stripe subscription checks
3. `conversation-count-race-conditions.integration.test.ts` - Race conditions in Redis operations
4. `trial-period-transitions.integration.test.ts` - Trial period state transitions

## Running the Tests

```bash
cd backend

# Run all unit and integration tests (default, fast)
npm test

# Run only unit tests (very fast, no external dependencies)
npm run test:unit

# Run only integration tests (requires Redis)
npm run test:int

# Run e2e tests (slow, requires Redis + OpenAI, expensive!)
npm run test:e2e

# Run specific test file
npx jest tests/int/throttling-logic.test.ts

# Watch mode during development
npm run test:watch

# Coverage report
npm run test:coverage
```

## 🐛 Potential Bugs These Tests Are Designed to Catch

### 1. Throttling Logic Bugs

#### 1.1 Day 7 Boundary Confusion
- **Test**: `should NOT throttle user on day 7 (last day of trial)`
- **Bug**: Code uses `days > 7` but documentation says "after day 7" - is day 7 included in trial?
- **Impact**: Users might be throttled one day early or late
- **File**: `throttling-logic.integration.test.ts`

#### 1.2 Partial Day Calculation
- **Test**: `should use floor for partial days`
- **Bug**: 7 days + 23 hours might round differently than expected
- **Impact**: User throttled hours too early or late
- **File**: `trial-period-transitions.integration.test.ts`

#### 1.3 Missing signedUpAt Handling
- **Test**: `should handle missing signedUpAt by setting it to now`
- **Bug**: getDaysSinceSignup() sets signedUpAt but might not persist it
- **Impact**: User's signup date keeps changing, trial never ends
- **File**: `throttling-logic.integration.test.ts`

#### 1.4 Invalid signedUpAt Type
- **Test**: `should handle invalid signedUpAt format gracefully`
- **Bug**: Number or invalid string might cause DateTime.fromISO() to fail
- **Impact**: Crashes or unexpected behavior
- **File**: `throttling-logic.integration.test.ts`

### 2. Race Condition Bugs (CRITICAL)

#### 2.1 SET vs INCR Race Condition
- **Test**: `BUG: First increment uses SET, subsequent use INCR - race condition exists`
- **Bug**: Two simultaneous first increments both use SET, losing one count
- **Code**:
  ```typescript
  if (!count) {
    await this.redis.set(key, "1", "EX", 86400); // RACE HERE!
  } else {
    await this.redis.incr(key);
  }
  ```
- **Impact**: Multiple conversations allowed when only 1 should be
- **Fix**: Use atomic INCR + EXPIRE or Lua script
- **File**: `conversation-count-race-conditions.integration.test.ts`

#### 2.2 Lost Increments Under Load
- **Test**: `BUG: Multiple rapid increments can lose counts`
- **Bug**: 100 concurrent increments might result in count < 100
- **Impact**: User gets more free conversations than allowed
- **File**: `conversation-count-race-conditions.integration.test.ts`

#### 2.3 Check-Then-Act Pattern
- **Test**: `BUG: Check-then-act allows double spending`
- **Bug**: Two requests check canStart() simultaneously, both return true, both increment
- **Impact**: User can bypass 1-per-day limit with concurrent requests
- **Fix**: Atomic check-and-increment operation
- **File**: `conversation-count-race-conditions.integration.test.ts`

#### 2.4 TTL Not Preserved After INCR
- **Test**: `should preserve TTL when using INCR after SET`
- **Bug**: If INCR doesn't preserve TTL, key becomes persistent
- **Impact**: Conversation count never resets, user permanently throttled
- **File**: `conversation-count-race-conditions.integration.test.ts`

### 3. Stripe Integration Bugs

#### 3.1 Development Mode Backdoor
- **Test**: `should return true if Stripe is not initialized (dev mode)`
- **Bug**: checkSubscription() returns TRUE when Stripe is disabled
- **Code**: `return true; // TODO: Remove this in production`
- **Impact**: EVERYONE gets premium access if Stripe fails to initialize in production!
- **File**: `stripe-integration.integration.test.ts`

#### 3.2 Double Plus Sign in Phone Number
- **Test**: `should handle phone number already with plus sign`
- **Bug**: Code always adds '+' prefix, even if phone already has it
- **Code**: `query: 'phone:'+${phoneNumber}'` // Results in '++1234567890'
- **Impact**: Customer search fails for phones with + prefix
- **File**: `stripe-integration.integration.test.ts`

#### 3.3 No Webhook Handlers
- **Test**: `should note that webhook handling is missing`
- **Bug**: No handlers for customer.subscription.updated/deleted events
- **Impact**: isPremium flag never auto-updates when subscription changes
- **Fix**: Implement Stripe webhook endpoint
- **File**: `stripe-integration.integration.test.ts`

#### 3.4 No Caching of Subscription Status
- **Test**: `should handle concurrent checkSubscription calls for same user`
- **Bug**: Every check makes 2 Stripe API calls (customer search + subscription list)
- **Impact**: Rate limiting, slow performance, unnecessary costs
- **Fix**: Cache subscription status for 5-10 minutes
- **File**: `stripe-integration.integration.test.ts`

#### 3.5 Only Checks 'active' Status
- **Test**: `should handle subscription with past_due status`
- **Bug**: Only checks for 'active' subscriptions, not 'trialing' or 'past_due'
- **Impact**: User with payment issue immediately loses access (harsh!)
- **File**: `stripe-integration.integration.test.ts`

### 4. Timezone Bugs

#### 4.1 Server vs User Timezone Mismatch
- **Test**: `should handle user in different timezone than server`
- **Bug**: DateTime.now().toISODate() uses server's local timezone
- **Impact**: User in Tokyo at 11 PM gets throttled for "tomorrow's" conversation
- **Fix**: Store user timezone and use it for date calculations
- **File**: `conversation-count-race-conditions.integration.test.ts`

#### 4.2 Date Boundary Confusion
- **Test**: `should handle date rollover at midnight`
- **Bug**: User near midnight might see date change mid-conversation
- **Impact**: Confusing UX, conversation might be counted for wrong day
- **File**: `conversation-count-race-conditions.integration.test.ts`

### 5. Premium User Bypass Bugs

#### 5.1 Premium Users Still Limited by Conversation Count
- **Test**: `BUG: Premium users are throttled by conversation count`
- **Bug**: canStartConversationToday() doesn't check isPremium flag
- **Impact**: Premium users can't have multiple conversations per day!
- **Fix**: Add premium check to canStartConversationToday()
- **File**: `trial-period-transitions.integration.test.ts`

#### 5.2 Premium Upgrade Not Immediate
- **Test**: `should immediately disable throttling when upgraded to premium`
- **Bug**: If subscription status isn't checked frequently, delay in access
- **Impact**: User pays for premium but still throttled until next check
- **File**: `trial-period-transitions.integration.test.ts`

### 6. Trial Period Transition Bugs

#### 6.1 Off-By-One in Warning Period
- **Test**: `should verify exact boundaries for warnings (days 3-6)`
- **Bug**: Warning logic uses `>= 3 && < 7` but might have edge case
- **Impact**: Warning shows on wrong days
- **File**: `trial-period-transitions.integration.test.ts`

#### 6.2 Inconsistent Throttle/Prompt Logic
- **Test**: `BUG: shouldThrottle uses > 7, not >= 8`
- **Bug**: shouldThrottle and shouldPromptForSubscription use same logic but might diverge
- **Impact**: Confusing user experience
- **File**: `trial-period-transitions.integration.test.ts`

#### 6.3 Future Signup Date
- **Test**: `should handle future signup date gracefully`
- **Bug**: No validation that signedUpAt is in the past
- **Impact**: Negative days calculation, weird behavior
- **File**: `trial-period-transitions.integration.test.ts`

## 🔥 Most Critical Bugs (Fix These First!)

### Priority 1: SECURITY/REVENUE RISK
1. **Stripe dev mode backdoor** - Everyone gets premium if Stripe fails (P0)
2. **Race condition in conversation count** - Users bypass throttling (P0)
3. **Premium users throttled by count** - Premium users can't use paid features (P0)

### Priority 2: DATA INTEGRITY
4. **No Stripe webhooks** - isPremium never auto-updates (P1)
5. **Lost increments** - Concurrent requests lose counts (P1)
6. **Persistent Redis keys** - TTL not set, throttling permanent (P1)

### Priority 3: USER EXPERIENCE
7. **Timezone mismatches** - Users in different TZ get wrong day boundaries (P2)
8. **Double plus sign** - Customer search fails for some phones (P2)
9. **Day 7 boundary confusion** - User throttled early/late (P2)

## Test Coverage Summary

| Component | Tests | Coverage Focus |
|-----------|-------|----------------|
| Throttling Logic | 40+ | Boundary conditions, day counting, edge cases |
| Stripe Integration | 30+ | Error handling, API failures, edge cases |
| Race Conditions | 25+ | Concurrent access, Redis atomicity |
| Trial Transitions | 35+ | State changes, boundary tests |

## Known Test Limitations

1. **Time-based tests** - Some tests might be flaky near midnight
2. **Redis required** - Integration tests need real Redis instance
3. **Stripe mocked** - Real Stripe API not tested (expensive)
4. **No load testing** - Race conditions might appear only under heavy load

## Next Steps (After Finding Bugs)

Once tests are run and bugs are confirmed:

1. Document failing tests with actual vs expected behavior
2. Prioritize bugs by severity (use table above)
3. Write fixes one bug at a time
4. Verify each fix with the specific test
5. Add regression tests for any new bugs found

## How to Add More Tests

```typescript
// In appropriate test file:
it('should handle [specific edge case]', async () => {
  // Arrange: Set up test data
  const subscriber = await subscriberService.createSubscriber(testPhone, {
    signedUpAt: DateTime.now().minus({ days: 5 }).toISO(),
  });

  // Act: Perform the operation
  const result = subscriberService.shouldThrottle(subscriber);

  // Assert: Verify expected behavior
  expect(result).toBe(false);
});
```

## Test Environment Setup

```bash
# 1. Ensure Redis is running
docker run -d -p 6379:6379 redis:alpine

# or
redis-server

# 2. Set environment variables
export REDIS_HOST=localhost
export REDIS_PORT=6379
export REDIS_PASSWORD=  # Empty for local dev

# 3. Run tests
npm test
```

## Viewing Test Results

Tests will output console logs showing:
- Actual counts vs expected counts (race condition tests)
- Timezone date mismatches (timezone tests)
- Bug detection messages (when bugs are found)

Look for lines like:
```
BUG DETECTED: Lost 12 increments due to race condition!
BUG: Server and user timezone dates differ!
```

These indicate bugs found during test execution.
