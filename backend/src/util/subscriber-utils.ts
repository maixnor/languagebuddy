import { Language, LanguageDeficiency, Subscriber } from "../types";


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

        // Then, sort by least recently practiced (or never practiced)
        const aLastPracticed = a.lastPracticedAt?.getTime() ?? 0;
        const bLastPracticed = b.lastPracticedAt?.getTime() ?? 0;
        if (aLastPracticed !== bLastPracticed) {
            return aLastPracticed - bLastPracticed; // Older (smaller timestamp) first
        }

        // Finally, sort by most recent occurrence
        const aLastOccurrence = a.lastOccurrence?.getTime() ?? 0;
        const bLastOccurrence = b.lastOccurrence?.getTime() ?? 0;
        return bLastOccurrence - aLastOccurrence; // More recent first
    });

    // Return top N deficiencies
    return sortedDeficiencies.slice(0, maxCount);
};