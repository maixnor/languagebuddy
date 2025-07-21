// Handles information gathering mode for subscribers
import { getMissingProfileFieldsReflective } from '../util/profile-reflection';
import { Subscriber } from '../types';

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
