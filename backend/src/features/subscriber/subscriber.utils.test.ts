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
    const result = selectDeficienciesToPractice(language);
    
    // Never practiced should come first, then oldest practice
    expect(result[0].specificArea).toBe('subjunctive mood');
    expect(result[1].specificArea).toBe('future tense');
    expect(result[2].specificArea).toBe('past tense');
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
    
    // Expected order:
    // 1. major-never-practiced (major severity, never practiced)
    // 2. major-practiced (major severity, practiced recently)
    // 3. moderate-old-practice (moderate severity)
    expect(result[0].specificArea).toBe('major-never-practiced');
    expect(result[1].specificArea).toBe('major-practiced');
    expect(result[2].specificArea).toBe('moderate-old-practice');
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
});
