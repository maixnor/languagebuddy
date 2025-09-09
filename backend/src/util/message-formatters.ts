/**
 * Converts markdown text to WhatsApp-friendly format
 * @param markdown The markdown text to convert
 * @returns WhatsApp-friendly formatted text
 */
export function markdownToWhatsApp(markdown: string): string {
  let text = markdown;
  
  // Use temporary placeholders to avoid conflicts
  const BOLD_PLACEHOLDER = '§§BOLD§§';
  const ITALIC_PLACEHOLDER = '§§ITALIC§§';
  const STRIKE_PLACEHOLDER = '§§STRIKE§§';
  
  // Store the actual content with placeholders
  const boldMatches: string[] = [];
  const italicMatches: string[] = [];
  const strikeMatches: string[] = [];
  
  // Convert strikethrough: ~~text~~ to placeholder
  text = text.replace(/~~([^~]+?)~~/g, (match, content) => {
    strikeMatches.push(content);
    return `${STRIKE_PLACEHOLDER}${strikeMatches.length - 1}${STRIKE_PLACEHOLDER}`;
  });
  
  // Convert bold: **text** and __text__ to placeholder
  text = text.replace(/\*\*([^*]+?)\*\*/g, (match, content) => {
    boldMatches.push(content);
    return `${BOLD_PLACEHOLDER}${boldMatches.length - 1}${BOLD_PLACEHOLDER}`;
  });
  text = text.replace(/__([^_]+?)__/g, (match, content) => {
    boldMatches.push(content);
    return `${BOLD_PLACEHOLDER}${boldMatches.length - 1}${BOLD_PLACEHOLDER}`;
  });
  
  // Convert remaining single asterisks and underscores to italic
  text = text.replace(/\*([^*]+?)\*/g, (match, content) => {
    italicMatches.push(content);
    return `${ITALIC_PLACEHOLDER}${italicMatches.length - 1}${ITALIC_PLACEHOLDER}`;
  });
  text = text.replace(/_([^_]+?)_/g, (match, content) => {
    italicMatches.push(content);
    return `${ITALIC_PLACEHOLDER}${italicMatches.length - 1}${ITALIC_PLACEHOLDER}`;
  });
  
  // Convert headers to bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (match, content) => {
    boldMatches.push(content);
    return `${BOLD_PLACEHOLDER}${boldMatches.length - 1}${BOLD_PLACEHOLDER}`;
  });
  
  // Convert lists
  text = text.replace(/^[\s]*[-*+]\s+(.+)$/gm, '• $1');
  text = text.replace(/^[\s]*(\d+)\.\s+(.+)$/gm, '$1. $2');
  
  // Clean up markdown artifacts
  text = text.replace(/^\s*>\s+(.+)$/gm, '$1'); // Remove blockquotes
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Convert links to just text
  
  // Remove excessive line breaks
  text = text.replace(/\n{3,}/g, '\n\n');
  
  // Replace placeholders with WhatsApp formatting
  text = text.replace(new RegExp(`${BOLD_PLACEHOLDER}(\\d+)${BOLD_PLACEHOLDER}`, 'g'), (match, index) => {
    return `*${boldMatches[parseInt(index)]}*`;
  });
  
  text = text.replace(new RegExp(`${ITALIC_PLACEHOLDER}(\\d+)${ITALIC_PLACEHOLDER}`, 'g'), (match, index) => {
    return `_${italicMatches[parseInt(index)]}_`;
  });
  
  text = text.replace(new RegExp(`${STRIKE_PLACEHOLDER}(\\d+)${STRIKE_PLACEHOLDER}`, 'g'), (match, index) => {
    return `~${strikeMatches[parseInt(index)]}~`;
  });
  
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
