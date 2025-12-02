### Prompt: Create Feature Validation Helper Scripts

**Goal:** Develop simple command-line scripts to manually validate specific features during development.

**Context:** Need quick, automated checks to ensure features work as expected before deployment.

**Target File:** `backend/src/scripts/validate-features.ts` (new file, potentially multiple scripts or a single script with flags)

**Details:**
- Create scripts to validate:
  - **Deficiencies:** Are they recorded, practiced, and `lastPracticedAt` updated? (`npm run validate:deficiencies`)
  - **Digests:** Are they created on schedule, profiles updated, conversations cleared? (`npm run validate:digests`)
  - **Timestamps:** Do all messages have timestamps, are gaps calculated correctly? (`npm run validate:timestamps`)
  - **Throttling:** Are trial limits working, premium users unlimited, day counting accurate? (`npm run validate:throttling`)
- Each script should run checks and print clear `✓` or `✗` with explanations.

**Expected Impact:** Increased confidence in feature functionality, reduced pre-deployment bugs.
