
# Time awareness

- [ ] The conversation history should include timestamps when the user messages were received to have some awareness of time. i.e. GPT should be able to notice if 2 minutes or 2 hours have passed between messages
- [ ] Also then I can end conversations over night and that works well too.

# Night time

- [ ] Figure out time zone
- [ ] Then with the time zone I can know when nighttime is and reset the conversation at 3 in the morning
- [x] then let GPT calculate a digest of the conversation, if it is with vocabulary save the specific vocabulary as well, so GPT can have a somewhat decent context over what happened the past days

## Digest System Implementation

- [x] Create DigestService for conversation analysis
- [x] Implement LLM-based conversation analysis
- [x] Add digest tools for manual/automatic digest creation
- [x] Integrate with service container and agent tools
- [x] Add user memos for personal context retention
- [x] Update subscriber profiles based on digest insights
- [x] Create comprehensive test suite
- [x] Document the digest system functionality
- [x] Track deficiency practice in digests (automatically updates lastPracticedAt and practiceCount)
- [ ] Add automatic digest creation at conversation end
- [ ] Implement conversation metrics analysis (currently skipped)
- [ ] Add scheduled digest cleanup and archiving

## Adaptive Weakness Integration (COMPLETED)

- [x] Extended LanguageDeficiency type with lastPracticedAt and practiceCount fields
- [x] Created selectDeficienciesToPractice() utility for prioritizing weak areas
- [x] Added add_language_deficiency tool for recording new deficiencies
- [x] Enhanced system prompts to include top 3 deficiencies with natural integration instructions
- [x] Implemented fuzzy matching in digest service to detect when deficiencies are practiced
- [x] Automatic updates to deficiency metadata during conversation analysis
- [x] Comprehensive test coverage (22 new tests, all passing)

# User probing

- [ ] GPT should try to fill out all information missing in the specific subscriber object to have full information at all times

# verify user subscription

- [x] every night the covnersation history is cleared
- [x] only on initiating a new conversation the subscription status is checked, i.e. max once per day

# GPT initiated conversation

- [ ] seek out random points in time to message the user with whatever short smalltalk you can think of, ideally about the topic the user is currently trying to learn then get a first response from GPT and send that to the user

# Payment integration

- [x] figure out how this thing with the payment links works exactly, but I presume via the phone number in the form the phone field is populated so I can search for it later.

# Whatsapp behavior

- [ ] add a logo and description to give the buddy a bit more personality
- [ ] when the response from GPT is returned have a typing... status issued and wait based on the amount of words in the GPT response, the function should have a cap of 10s
ignore the typing when a user command is being handled

# User commands

- [ ] translate
- [ ] define

# GPT commands

- [x] does not work yet, but most of the code is written already, only need to debug

# Code TODOs

## Stripe Service
- [x] Remove bypass check in production (stripe-service.ts:30) - Currently returns true without checking premium status

## Language Buddy Agent
- [ ] Don't save oneShotMessages to the normal conversational thread (language-buddy-agent.ts:83)

## Scheduler Service
- [ ] Adjust nextPushMessageAt for user timezone instead of UTC (scheduler-service.ts:61)
- [ ] Implement actual nightly digest triggering (scheduler-service.ts:219)
- [ ] Implement actual history cleanup triggering (scheduler-service.ts:224)

## Types/Subscriber Model
- [ ] Use streakData field in subscriber model (types/index.ts:65)
- [ ] Actually use notification preferences fields (types/index.ts:72)

## Info Gathering
- [ ] Change to use reflection of the field and provide a good prompt to find out user info (info-gathering.ts:16)

## User Commands
- [ ] Implement one-shot requests (user-commands.ts:57)
- [ ] Let GPT handle quiz command (user-commands.ts:58)
- [ ] Let GPT handle practice command (user-commands.ts:72)



