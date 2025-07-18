// Returns a list of missing (undefined, null, or empty string/array) fields in the profile object, including any new fields added to the type.
export function getMissingProfileFieldsReflective(profile: Record<string, any>): string[] {
  const missing: string[] = [];
  for (const key of Object.keys(profile)) {
    const value = profile[key];
    if (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0)
    ) {
      missing.push(key);
    }
    // Optionally, check for nested objects (e.g. language levels)
    if (Array.isArray(value)) {
      value.forEach((item: any) => {
        if (item && typeof item === 'object') {
          for (const subKey of Object.keys(item)) {
            if (
              item[subKey] === undefined ||
              item[subKey] === null ||
              (typeof item[subKey] === 'string' && item[subKey].trim() === '')
            ) {
              missing.push(`${key}.${subKey}`);
            }
          }
        }
      });
    }
  }
  return missing;
}
