import { Language, Subscriber } from "../types";


export const getFirstLearningLanguage = (subscriber: Subscriber): Language => {
    return subscriber.profile.learningLanguages[0];
};

/**
 * Returns the number of days since the user signed up.
 * If signedUpAt is missing, returns undefined.
 */
export function getDaysSinceSignup(subscriber: Subscriber): number | undefined {
  if (!subscriber.signedUpAt) return undefined;
  const signupDate = new Date(subscriber.signedUpAt);
  const now = new Date();
  // Calculate difference in milliseconds
  const diffMs = now.getTime() - signupDate.getTime();
  // Convert ms to days
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}