import { Language, LanguageDeficiency, Subscriber } from "./subscriber.types"; // Adjusted import


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