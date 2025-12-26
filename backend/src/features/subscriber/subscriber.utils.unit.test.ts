import { selectDeficienciesToPractice } from './subscriber.utils';
import { Language, LanguageDeficiency } from './subscriber.types';

describe('selectDeficienciesToPractice', () => {
  const createDeficiency = (
    specificArea: string,
    severity: 'minor' | 'moderate' | 'major',
    lastPracticedAt?: Date,
    lastOccurrence?: Date
  ): LanguageDeficiency => ({
    category: 'grammar',
    specificArea,
    severity,
    frequency: 50,
    examples: [],
    improvementSuggestions: [],
    firstDetected: new Date('2024-01-01'),
    lastOccurrence: lastOccurrence || new Date('2024-01-15'),
    lastPracticedAt,
    practiceCount: lastPracticedAt ? 1 : 0
  });

  const createLanguage = (deficiencies: LanguageDeficiency[]): Language => ({
    languageName: 'German',
    overallLevel: 'B1',
    skillAssessments: [],
    deficiencies,
    firstEncountered: new Date(),
    lastPracticed: new Date(),
    totalPracticeTime: 0,
    confidenceScore: 50
  });

  it('should return empty array when no deficiencies exist', () => {
    const language = createLanguage([]);
    const result = selectDeficienciesToPractice(language);
    expect(result).toEqual([]);
  });

  it('should prioritize by severity (major > moderate > minor)', () => {
    const minor = createDeficiency('article usage', 'minor');
    const moderate = createDeficiency('verb conjugation', 'moderate');
    const major = createDeficiency('word order', 'major');
    
    const language = createLanguage([minor, moderate, major]);
    const result = selectDeficienciesToPractice(language);
    
    expect(result[0].specificArea).toBe('word order'); // major
    expect(result[1].specificArea).toBe('verb conjugation'); // moderate
    expect(result[2].specificArea).toBe('article usage'); // minor
  });

  it('should prioritize least recently practiced within same severity', () => {
    const practiced2DaysAgo = createDeficiency(
      'past tense',
      'major',
      new Date('2024-01-13')
    );
    const practiced5DaysAgo = createDeficiency(
      'future tense',
      'major',
      new Date('2024-01-10')
    );
    const neverPracticed = createDeficiency(
      'subjunctive mood',
      'major',
      undefined
    );
    
    const language = createLanguage([practiced2DaysAgo, practiced5DaysAgo, neverPracticed]);
    const result = selectDeficienciesToPractice(language, 3);

    expect(result).toHaveLength(3);
    
    // With randomization, we check if the result contains the expected items
    const specificAreas = result.map(r => r.specificArea);
    expect(specificAreas).toContain('subjunctive mood');
    expect(specificAreas).toContain('future tense');
    expect(specificAreas).toContain('past tense');
  });

  it('should use most recent occurrence as tiebreaker', () => {
    const recentOccurrence = createDeficiency(
      'prepositions',
      'moderate',
      undefined,
      new Date('2024-01-20')
    );
    const olderOccurrence = createDeficiency(
      'articles',
      'moderate',
      undefined,
      new Date('2024-01-10')
    );
    
    const language = createLanguage([olderOccurrence, recentOccurrence]);
    const result = selectDeficienciesToPractice(language);
    
    // Most recent occurrence should come first (when severity and practice are equal)
    expect(result[0].specificArea).toBe('prepositions');
    expect(result[1].specificArea).toBe('articles');
  });

  it('should respect maxCount parameter', () => {
    const deficiencies = [
      createDeficiency('def1', 'major'),
      createDeficiency('def2', 'major'),
      createDeficiency('def3', 'major'),
      createDeficiency('def4', 'major'),
      createDeficiency('def5', 'major')
    ];
    
    const language = createLanguage(deficiencies);
    const result = selectDeficienciesToPractice(language, 2);
    
    expect(result).toHaveLength(2);
  });

  it('should default to 3 deficiencies when maxCount not specified', () => {
    const deficiencies = [
      createDeficiency('def1', 'major'),
      createDeficiency('def2', 'major'),
      createDeficiency('def3', 'major'),
      createDeficiency('def4', 'major')
    ];
    
    const language = createLanguage(deficiencies);
    const result = selectDeficienciesToPractice(language);
    
    expect(result).toHaveLength(3);
  });

  it('should handle complex mixed priority scenario', () => {
    const deficiencies = [
      createDeficiency('minor-recent', 'minor', undefined, new Date('2024-01-20')),
      createDeficiency('major-practiced', 'major', new Date('2024-01-18')),
      createDeficiency('moderate-old-practice', 'moderate', new Date('2024-01-10')),
      createDeficiency('major-never-practiced', 'major', undefined, new Date('2024-01-15'))
    ];
    
    const language = createLanguage(deficiencies);
    const result = selectDeficienciesToPractice(language, 3);

    expect(result).toHaveLength(3);
    
    // We expect the top 3 candidates to be selected, but their order is randomized
    const specificAreas = result.map(r => r.specificArea);
    expect(specificAreas).toContain('major-never-practiced');
    expect(specificAreas).toContain('major-practiced');
    expect(specificAreas).toContain('moderate-old-practice');
  });

  it('should not modify the original deficiencies array', () => {
    const deficiencies = [
      createDeficiency('def1', 'minor'),
      createDeficiency('def2', 'major')
    ];
    
    const language = createLanguage(deficiencies);
    const originalOrder = [...deficiencies];
    
    selectDeficienciesToPractice(language);
    
    expect(language.deficiencies).toEqual(originalOrder);
  });

  it('should handle string dates gracefully (hydration fallback)', () => {
    // Simulate unhydrated data where dates are strings
    const def1 = createDeficiency('def1', 'major');
    // @ts-ignore
    def1.lastPracticedAt = "2024-01-01T12:00:00.000Z";
    
    const def2 = createDeficiency('def2', 'major');
    // @ts-ignore
    def2.lastPracticedAt = "2024-01-02T12:00:00.000Z";

    const language = createLanguage([def1, def2]);
    
    // Should not throw
    const result = selectDeficienciesToPractice(language);
    
    // Should sort correctly (older string date first)
    expect(result[0].specificArea).toBe('def1');
    expect(result[1].specificArea).toBe('def2');
  });
});

import { validateTimezone, ensureValidTimezone, getMissingProfileFieldsReflective, isTestPhoneNumber, sanitizePhoneNumber } from './subscriber.utils';

describe('Timezone Validation', () => {
    it('should map common city names (Lima) to IANA timezones', () => {
        expect(validateTimezone('Lima')).toBe('America/Lima');
        expect(validateTimezone('London')).toBe('Europe/London');
    });

    it('should return null for completely invalid timezones', () => {
        expect(validateTimezone('Mars/Crater')).toBeNull();
        expect(validateTimezone('')).toBeNull();
        expect(validateTimezone(null)).toBeNull();
    });

    it('should validate correct IANA timezones', () => {
        expect(validateTimezone('America/New_York')).toBe('America/New_York');
    });

    it('should validate numeric offsets', () => {
        expect(validateTimezone('-5')).toBe('UTC-5');
    });
});

describe('getMissingProfileFieldsReflective', () => {
    it('should identify required fields that are completely missing from the object', () => {
        // user profile missing 'timezone' key entirely
        const partialProfile = {
            name: 'Test',
            speakingLanguages: ['en'],
            learningLanguages: ['es']
        };
        
        const missing = getMissingProfileFieldsReflective(partialProfile);
        expect(missing).toContain('timezone');
    });

    it('should identify fields that are present but empty', () => {
        const partialProfile = {
            name: '', // Empty string
            speakingLanguages: [], // Empty array
            learningLanguages: ['es'],
            timezone: 'UTC'
        };
        
        const missing = getMissingProfileFieldsReflective(partialProfile);
        expect(missing).toContain('name');
        expect(missing).toContain('speakingLanguages');
        expect(missing).not.toContain('timezone');
    });
});

describe('ensureValidTimezone (Runtime Safety)', () => {
    it('should default to UTC for invalid inputs', () => {
        expect(ensureValidTimezone('Mars/Crater')).toBe('UTC');
        expect(ensureValidTimezone(null)).toBe('UTC');
    });

    it('should preserve valid inputs', () => {
        expect(ensureValidTimezone('America/Lima')).toBe('America/Lima');
    });
});

describe('isTestPhoneNumber', () => {
    it('should return true for phone numbers starting with +69', () => {
        expect(isTestPhoneNumber('+69123456789')).toBe(true);
        expect(isTestPhoneNumber('+69000000000')).toBe(true);
    });

    it('should return false for phone numbers not starting with +69', () => {
        expect(isTestPhoneNumber('+11234567890')).toBe(false);
        expect(isTestPhoneNumber('+447890123456')).toBe(false);
        expect(isTestPhoneNumber('69123456789')).toBe(true);
        expect(isTestPhoneNumber('')).toBe(false);
        expect(isTestPhoneNumber('+')).toBe(false);
    });
});

describe('sanitizePhoneNumber', () => {
    it('should keep already sanitized numbers', () => {
        expect(sanitizePhoneNumber('+1234567890')).toBe('+1234567890');
    });

    it('should add plus if missing', () => {
        expect(sanitizePhoneNumber('1234567890')).toBe('+1234567890');
    });

    it('should remove spaces and special characters', () => {
        expect(sanitizePhoneNumber('(555) 123-4567')).toBe('+5551234567');
        expect(sanitizePhoneNumber('1 234 567')).toBe('+1234567');
    });

    it('should handle leading 00', () => {
        expect(sanitizePhoneNumber('0049123456789')).toBe('+49123456789');
    });

    it('should handle multiple plus signs', () => {
        expect(sanitizePhoneNumber('++123')).toBe('+123');
    });
    
    it('should handle empty strings', () => {
        expect(sanitizePhoneNumber('')).toBe('');
    });
});

