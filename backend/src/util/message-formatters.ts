/**
 * Converts markdown text to WhatsApp-friendly format
 * @param markdown The markdown text to convert
 * @returns WhatsApp-friendly formatted text
 */
export function markdownToWhatsApp(markdown: string): string {
  let text = markdown;
  
  // Protect multiple underscores (quiz placeholders) from italic conversion
  text = text.replace(/_{3,}/g, (match) => `§PLACEHOLDER§${match.length}§`);
  
  // Convert strikethrough first
  text = text.replace(/~~([^~]+?)~~/g, '~$1~');
  
  // Convert bold (double markers first) using unique placeholders
  text = text.replace(/\*\*([^*]+?)\*\*/g, '§BOLD§$1§/BOLD§');
  text = text.replace(/__([^_]+?)__/g, '§BOLD§$1§/BOLD§');
  
  // Convert headers to bold (using placeholders too)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '§BOLD§$1§/BOLD§');
  
  // Convert italic (single markers) - now safe from bold conflicts
  // Exclude multiple underscores (quiz placeholders) from italic conversion
  text = text.replace(/\*([^*\n]+?)\*/g, '_$1_');
  text = text.replace(/\b_([^_\n]+?)_\b(?!_)/g, '_$1_');
  
  // Restore bold formatting
  text = text.replace(/§BOLD§/g, '*');
  text = text.replace(/§\/BOLD§/g, '*');
  
  // Convert lists
  text = text.replace(/^[\s]*[-*+]\s+(.+)$/gm, '• $1');
  text = text.replace(/^[\s]*(\d+)\.\s+(.+)$/gm, '$1. $2');
  
  // Clean up markdown artifacts
  text = text.replace(/^\s*>\s+(.+)$/gm, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/\n{3,}/g, '\n\n');

  // Restore quiz placeholders
  text = text.replace(/§PLACEHOLDER§(\d+)§/g, (match, length) => '_'.repeat(parseInt(length)));

  return text.trim();
}

/**
 * Splits a message by separator and returns an array of messages
 * @param message The message to split
 * @param separator The separator to split by (default: '---')
 * @returns Array of split messages
 */
export function splitMessageBySeparator(message: string, separator: string = '---'): string[] {
  const parts = message.split(separator);
  return parts
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

/**
 * Converts markdown to WhatsApp format and splits by separator
 * @param markdown The markdown text to process
 * @param separator The separator to split by (default: '---')
 * @returns Array of WhatsApp-friendly messages
 */
export function processMarkdownForWhatsApp(markdown: string, separator: string = '---'): string[] {
  const whatsappText = markdownToWhatsApp(markdown);
  return splitMessageBySeparator(whatsappText, separator);
}
