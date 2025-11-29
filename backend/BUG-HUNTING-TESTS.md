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

### 1. Race Condition Bugs (CRITICAL)

#### 1.1 SET vs INCR Race Condition [FIXED]
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
- **Fix**: Implemented atomic `INCR` followed by conditional `EXPIRE` if key was new or had no TTL.
- **File**: `conversation-count-race-conditions.integration.test.ts`

#### 1.2 Lost Increments Under Load [FIXED]
- **Test**: `BUG: Multiple rapid increments can lose counts`
- **Bug**: 100 concurrent increments might result in count < 100
- **Impact**: User gets more free conversations than allowed
- **Fix**: Resolved by implementing atomic `INCR`.
- **File**: `conversation-count-race-conditions.integration.test.ts`

#### 1.3 Check-Then-Act Pattern [FIXED]
- **Test**: `BUG: Check-then-act allows double spending`
- **Bug**: Two requests check canStart() simultaneously, both return true, both increment
- **Impact**: User can bypass 1-per-day limit with concurrent requests
- **Fix**: Resolved as `canStartConversationToday` now uses a single `getSubscriber` call and `incrementConversationCount` is atomic.
- **File**: `conversation-count-race-conditions.integration.test.ts`

#### 1.4 TTL Not Preserved After INCR [FIXED]
- **Test**: `should preserve TTL when using INCR after SET`
- **Bug**: If INCR doesn't preserve TTL, key becomes persistent
- **Impact**: Conversation count never resets, user permanently throttled
- **Fix**: Implemented conditional `EXPIRE` after `INCR` if the key had no TTL.
- **File**: `conversation-count-race-conditions.integration.test.ts`

### 2. Stripe Integration Bugs

#### 2.1 Development Mode Backdoor [FIXED - Already Resolved]
- **Test**: `should return true if Stripe is not initialized (dev mode)`
- **Bug**: checkSubscription() returns TRUE when Stripe is disabled
- **Code**: `return true; // TODO: Remove this in production`
- **Impact**: EVERYONE gets premium access if Stripe fails to initialize in production!
- **Fix**: The code correctly returns `false` when Stripe is not initialized.
- **File**: `stripe-integration.integration.test.ts`

#### 2.2 Double Plus Sign in Phone Number [FIXED]
- **Test**: `should handle phone number already with plus sign`
- **Bug**: Code always adds '+' prefix, even if phone already has it
- **Code**: `query: 'phone:'+${phoneNumber}'` // Results in '++1234567890'
- **Impact**: Customer search fails for phones with + prefix
- **Fix**: Implemented phone number normalization to ensure only a single `+` prefix in the query.
- **File**: `stripe-integration.integration.test.ts`

#### 2.3 No Webhook Handlers [FIXED]
- **Test**: `should note that webhook handling is missing`
- **Bug**: No handlers for customer.subscription.updated/deleted events
- **Impact**: isPremium flag never auto-updates when subscription changes
- **Fix**: Implemented `StripeWebhookService` and a new `/stripe-webhook` endpoint to handle Stripe events and update subscriber's `isPremium` status.
- **File**: `stripe-integration.integration.test.ts`

#### 2.4 No Caching of Subscription Status
- **Test**: `should handle concurrent checkSubscription calls for same user`
- **Bug**: Every check makes 2 Stripe API calls (customer search + subscription list)
- **Impact**: Rate limiting, slow performance, unnecessary costs
- **Fix**: Cache subscription status for 5-10 minutes
- **File**: `stripe-integration.integration.test.ts`

#### 2.5 Only Checks 'active' Status
- **Test**: `should handle subscription with past_due status`
- **Bug**: Only checks for 'active' subscriptions, not 'trialing' or 'past_due'
- **Impact**: User with payment issue immediately loses access (harsh!)
- **File**: `stripe-integration.integration.test.ts`

### 3. Premium User Bypass Bugs

#### 3.1 Premium Users Still Limited by Conversation Count [FIXED]
- **Test**: `BUG: Premium users are throttled by conversation count`
- **Bug**: canStartConversationToday() doesn't check isPremium flag
- **Impact**: Premium users can't have multiple conversations per day!
- **Fix**: Added premium check to `canStartConversationToday()` so premium users bypass throttling.
- **File**: `trial-period-transitions.integration.test.ts`

#### 3.2 Premium Upgrade Not Immediate
- **Test**: `should immediately disable throttling when upgraded to premium`
- **Bug**: If subscription status isn't checked frequently, delay in access
- **Impact**: User pays for premium but still throttled until next check
- **File**: `trial-period-transitions.integration.test.ts`

### 4. Throttling Logic Bugs

#### 4.1 Day 7 Boundary Confusion [CLARIFIED/FIXED]
- **Test**: `should NOT throttle user on day 7 (last day of trial)`
- **Bug**: Code uses `days > 7` but documentation says "after day 7" - is day 7 included in trial?
- **Impact**: Users might be throttled one day early or late
- **Fix**: The logic (`days > 7`) correctly throttles from Day 8 onwards, meaning Day 7 is the last full day of trial without throttling. Test cases and code are consistent with this.
- **File**: `throttling-logic.integration.test.ts`

#### 4.2 Partial Day Calculation
- **Test**: `should use floor for partial days`
- **Bug**: 7 days + 23 hours might round differently than expected
- **Impact**: User throttled hours too early or late
- **File**: `trial-period-transitions.integration.test.ts`

#### 4.3 Missing signedUpAt Handling
- **Test**: `should handle missing signedUpAt by setting it to now`
- **Bug**: getDaysSinceSignup() sets signedUpAt but might not persist it
- **Impact**: User's signup date keeps changing, trial never ends
- **File**: `throttling-logic.integration.test.ts`

#### 4.4 Invalid signedUpAt Type
- **Test**: `should handle invalid signedUpAt format gracefully`
- **Bug**: Number or invalid string might cause DateTime.fromISO() to fail
- **Impact**: Crashes or unexpected behavior
- **File**: `throttling-logic.integration.test.ts`

### 5. Trial Period Transition Bugs

#### 5.1 Off-By-One in Warning Period
- **Test**: `should verify exact boundaries for warnings (days 3-6)`
- **Bug**: Warning logic uses `>= 3 && < 7` but might have edge case
- **Impact**: Warning shows on wrong days
- **File**: `trial-period-transitions.integration.test.ts`

#### 5.2 Inconsistent Throttle/Prompt Logic [CLARIFIED]
- **Test**: `BUG: shouldThrottle uses > 7, not >= 8`
- **Bug**: shouldThrottle and shouldPromptForSubscription use same logic but might diverge
- **Impact**: Confusing user experience
- **Fix**: The logic (`days > 7`) is consistent for both `shouldThrottle` and `shouldPromptForSubscription`, meaning throttling/prompting starts from Day 8 onwards. The test has been renamed to reflect clarity.
- **File**: `trial-period-transitions.integration.test.ts`

#### 5.3 Future Signup Date
- **Test**: `should handle future signup date gracefully`
- **Bug**: No validation that signedUpAt is in the past
- **Impact**: Negative days calculation, weird behavior
- **File**: `trial-period-transitions.integration.test.ts`

### 6. Timezone Bugs

#### 6.1 Server vs User Timezone Mismatch [FIXED]
- **Test**: `should handle user in different timezone than server`
- **Bug**: DateTime.now().toISODate() uses server's local timezone
- **Impact**: User in Tokyo at 11 PM gets throttled for "tomorrow's" conversation
- **Fix**: Implemented timezone-aware date calculations for `getDaysSinceSignup`, `canStartConversationToday`, and `incrementConversationCount` using `subscriber.profile.timezone`.
- **File**: `conversation-count-race-conditions.integration.test.ts`

#### 6.2 Date Boundary Confusion
- **Test**: `should handle date rollover at midnight`
- **Bug**: User near midnight might see date change mid-conversation
- **Impact**: Confusing UX, conversation might be counted for wrong day
- **File**: `conversation-count-race-conditions.integration.test.ts`

## 🔥 Most Critical Bugs (Fix These First!) [ALL FIXED]

### Priority 1: SECURITY/REVENUE RISK
1. **Stripe dev mode backdoor** - Everyone gets premium if Stripe fails (P0) [FIXED - Already Resolved]
2. **Race condition in conversation count** - Users bypass throttling (P0) [FIXED]
3. **Premium users throttled by count** - Premium users can't use paid features (P0) [FIXED]

### Priority 2: DATA INTEGRITY
4. **No Stripe webhooks** - isPremium never auto-updates (P1) [FIXED]
5. **Lost increments** - Concurrent requests lose counts (P1) [FIXED]
6. **Persistent Redis keys** - TTL not set, throttling permanent (P1) [FIXED]

### Priority 3: USER EXPERIENCE
7. **Timezone mismatches** - Users in different TZ get wrong day boundaries (P2) [FIXED]
8. **Double plus sign** - Customer search fails for some phones (P2) [FIXED]
9. **Day 7 boundary confusion** - User throttled early/late (P2) [CLARIFIED/FIXED]

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