import { SubscriberProfileSchema } from "./subscriber.contracts";
import { Language, LanguageDeficiency, Subscriber } from "./subscriber.types"; // Adjusted import
import { DateTime } from 'luxon';
import { logger } from '../../core/config';

const COMMON_TIMEZONE_MAPPINGS: Record<string, string> = {
    'lima': 'America/Lima',
    'london': 'Europe/London',
    'paris': 'Europe/Paris',
    'berlin': 'Europe/Berlin',
    'tokyo': 'Asia/Tokyo',
    'new york': 'America/New_York',
    'los angeles': 'America/Los_Angeles',
    'chicago': 'America/Chicago',
    'madrid': 'Europe/Madrid',
    'rome': 'Europe/Rome',
};

/**
 * Validates that the provided timezone string is a valid Luxon timezone.
 * Supports IANA zone names (e.g., "America/Lima") and UTC offsets (e.g., "UTC-5").
 * Also attempts to correct simple numeric offsets (e.g., "-5" -> "UTC-5").
 * Returns null if invalid.
 */
export const validateTimezone = (timezone: string | number | undefined | null): string | null => {
    if (timezone === undefined || timezone === null || timezone === '') {
        return null;
    }

    let tzStr = String(timezone).trim();

    // 1. Check if it's already valid
    if (DateTime.local().setZone(tzStr).isValid) {
        return tzStr;
    }

    // 1.5 Check common mappings (case-insensitive)
    const lowerTz = tzStr.toLowerCase();
    if (COMMON_TIMEZONE_MAPPINGS[lowerTz]) {
        return COMMON_TIMEZONE_MAPPINGS[lowerTz];
    }

    // 2. Try to interpret as numeric offset (e.g., "-5", "5", "+5")
    // Luxon expects "UTC+5", "UTC-5"
    if (/^[+-]?\d+$/.test(tzStr)) {
        const offset = parseInt(tzStr, 10);
        const potentialTz = offset >= 0 ? `UTC+${offset}` : `UTC${offset}`;
        if (DateTime.local().setZone(potentialTz).isValid) {
            return potentialTz;
        }
    }

    // 3. If still invalid, return null
    logger.debug({ invalidTimezone: timezone }, "Invalid timezone provided");
    return null;
};

/**
 * Ensures that the provided timezone string is a valid Luxon timezone.
 * Defaults to 'UTC' if invalid.
 * Use this for runtime logic where a valid timezone is strictly required.
 */
export const ensureValidTimezone = (timezone: string | number | undefined | null): string => {
    return validateTimezone(timezone) || 'UTC';
};

export const getFirstLearningLanguage = (subscriber: Subscriber): Language => {
    return subscriber.profile.learningLanguages[0];
};

/**
 * Selects the top deficiencies for a language to focus on during conversation.
 * Prioritizes by:
 * 1. Severity (major > moderate > minor)
 * 2. Least recently practiced (older lastPracticedAt first)
 * 3. Most recent occurrence
 * 
 * @param language - The language to get deficiencies from
 * @param maxCount - Maximum number of deficiencies to return (default: 3)
 * @returns Array of deficiencies sorted by priority, limited to maxCount
 */
export const selectDeficienciesToPractice = (
    language: Language, 
    maxCount: number = 3
): LanguageDeficiency[] => {
    if (!language.deficiencies || language.deficiencies.length === 0) {
        return [];
    }

    // Severity weights for sorting
    const severityWeight = {
        'major': 3,
        'moderate': 2,
        'minor': 1
    };

    // Sort deficiencies by priority
    const sortedDeficiencies = [...language.deficiencies].sort((a, b) => {
        // First, sort by severity (higher severity = higher priority)
        const severityDiff = severityWeight[b.severity] - severityWeight[a.severity];
        if (severityDiff !== 0) {
            return severityDiff;
        }

        const getTime = (d: Date | string | undefined) => d ? new Date(d).getTime() : 0;

        // Then, sort by least recently practiced (or never practiced)
        const aLastPracticed = getTime(a.lastPracticedAt);
        const bLastPracticed = getTime(b.lastPracticedAt);
        if (aLastPracticed !== bLastPracticed) {
            return aLastPracticed - bLastPracticed; // Older (smaller timestamp) first
        }

        // Finally, sort by most recent occurrence
        const aLastOccurrence = getTime(a.lastOccurrence);
        const bLastOccurrence = getTime(b.lastOccurrence);
        return bLastOccurrence - aLastOccurrence; // More recent first
    });

    // Take the top N (candidate pool) to select from
    // We take up to 3 candidates (or maxCount if smaller) to ensure high priority but add variety
    const poolSize = Math.max(3, maxCount); 
    const candidates = sortedDeficiencies.slice(0, poolSize);

    // If we have fewer candidates than requested, just return them all
    if (candidates.length <= maxCount) {
        // Shuffle them anyway to prevent "always the same order" if the user has < 3 deficiencies
        return candidates.sort(() => Math.random() - 0.5);
    }

    // Otherwise, pick 'maxCount' random items from the 'candidates' pool
    const selected: LanguageDeficiency[] = [];
    const pool = [...candidates];
    
    for (let i = 0; i < maxCount; i++) {
        if (pool.length === 0) break;
        const randomIndex = Math.floor(Math.random() * pool.length);
        selected.push(pool[randomIndex]);
        pool.splice(randomIndex, 1); // Remove selected to avoid duplicates
    }

    return selected;
};

/**
 * Returns the next missing field for the subscriber, or null if complete
 */
export function getNextMissingField(subscriber: Subscriber): string | null {
  const missing = getMissingProfileFieldsReflective(subscriber.profile);
  return missing.length > 0 ? missing[0] : null;
}

/**
 * Returns a prompt for the next missing field
 */
// TODO change to use reflection of the field and provide a good prompt to find out the info of the user
// should also work with enums such that the llm can target specifically those values
export function getPromptForField(field: string): string {
  switch (field) {
    case 'name':
      return "What's your name?";
    case 'speakingLanguages':
      return "Which languages do you speak fluently?";
    case 'learningLanguages':
      return "Which language(s) are you learning?";
    case 'timezone':
      return "What is your timezone or where are you located?";
    default:
      if (field.endsWith('level')) return `What is your level in ${field.replace(' level', '')}?`;
      return `Please provide: ${field}`;
  }
}

// Returns a list of missing (undefined, null, or empty string/array) fields in the profile object.
// Checks against required fields defined in SubscriberProfileSchema.
export function getMissingProfileFieldsReflective(profile: Record<string, any>): string[] {
  const missing: string[] = [];
  const shape = SubscriberProfileSchema.shape;
  
  for (const key of Object.keys(shape)) {
    const fieldSchema = shape[key as keyof typeof shape];
    
    // Check if the field is optional in the Zod schema
    // Note: Zod's .isOptional() returns true for z.optional() wrapped types
    if (fieldSchema.isOptional()) {
        continue;
    }

    const value = profile[key];
    if (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0)
    ) {
      missing.push(key);
    }
  }
  return missing;
}

/**
 * Checks if a given phone number is a test phone number.
 * Test phone numbers start with '+69'.
 * @param phoneNumber The phone number to check.
 * @returns True if the phone number is a test number, false otherwise.
 */
export function isTestPhoneNumber(phoneNumber: string): boolean {
    const sanitized = sanitizePhoneNumber(phoneNumber);
    return sanitized.startsWith('+69');
}

/**
 * Sanitizes a phone number to E.164 format (roughly).
 * Ensures the number starts with '+' and contains only digits.
 * Replaces leading '00' with '+'.
 * Removes all other non-digit characters.
 * @param phone The input phone number string.
 * @returns The sanitized phone number string starting with '+'.
 */
export function sanitizePhoneNumber(phone: string): string {
    if (!phone) return "";
    
    // Remove all characters except digits and +
    let cleaned = phone.replace(/[^\d+]/g, '');

    // If it starts with '00', replace with '+'
    if (cleaned.startsWith('00')) {
        cleaned = '+' + cleaned.substring(2);
    }

    // Ensure it starts with +
    if (!cleaned.startsWith('+')) {
        cleaned = '+' + cleaned;
    }

    // Normalize multiple pluses at the start (e.g. ++1 -> +1)
    cleaned = '+' + cleaned.replace(/^\++/, '');

    return cleaned;
}

/**
 * Simple string hash function
 */
function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
}

/**
 * Deterministically selects a daily topic for the subscriber based on their phone number and the current date.
 * This ensures the topic remains consistent throughout the day (until the next day).
 * Candidates are drawn from 'interests' and 'currentObjectives'.
 */
export function getDailyTopic(subscriber: Subscriber): string | null {
    // Collect candidates
    // We look at the first learning language for objectives/interests
    // TODO: Support multiple learning languages?
    const language = subscriber.profile.learningLanguages?.[0];
    
    const interests = language?.interests || [];
    const objectives = language?.currentObjectives || [];
    
    // Combine and deduplicate
    const candidates = Array.from(new Set([...interests, ...objectives]));
    
    if (candidates.length === 0) {
        return null;
    }

    const timezone = ensureValidTimezone(subscriber.profile.timezone);
    const today = DateTime.now().setZone(timezone).toISODate(); // "2025-12-25"
    
    // Create a deterministic hash based on User ID + Date
    const seed = subscriber.connections.phone + today;
    const hash = simpleHash(seed);
    
    const index = Math.abs(hash) % candidates.length;
    return candidates[index];
}
