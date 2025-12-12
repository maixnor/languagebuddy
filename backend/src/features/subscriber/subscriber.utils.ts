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

    // Return top N deficiencies
    return sortedDeficiencies.slice(0, maxCount);
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
    return phoneNumber.startsWith('+69') || phoneNumber.startsWith('69');
}
