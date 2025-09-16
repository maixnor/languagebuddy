import { markdownToWhatsApp, splitMessageBySeparator, processMarkdownForWhatsApp } from '../src/util/message-formatters';

describe('Message Formatters', () => {
  describe('markdownToWhatsApp', () => {
    test('converts bold markdown to WhatsApp format', () => {
      expect(markdownToWhatsApp('**bold text**')).toBe('*bold text*');
      expect(markdownToWhatsApp('__bold text__')).toBe('*bold text*');
    });

    test('converts italic markdown to WhatsApp format', () => {
      expect(markdownToWhatsApp('*italic text*')).toBe('_italic text_');
      expect(markdownToWhatsApp('_italic text_')).toBe('_italic text_');
    });

    test('converts strikethrough markdown to WhatsApp format', () => {
      expect(markdownToWhatsApp('~~strikethrough~~')).toBe('~strikethrough~');
    });

    test('converts headers to bold text', () => {
      expect(markdownToWhatsApp('# Header 1')).toBe('*Header 1*');
      expect(markdownToWhatsApp('## Header 2')).toBe('*Header 2*');
      expect(markdownToWhatsApp('### Header 3')).toBe('*Header 3*');
    });

    test('converts bullet lists', () => {
      const markdown = `- Item 1
- Item 2
* Item 3`;
      const expected = `• Item 1
• Item 2
• Item 3`;
      expect(markdownToWhatsApp(markdown)).toBe(expected);
    });

    test('converts numbered lists', () => {
      const markdown = `1. First item
2. Second item
3. Third item`;
      const expected = `1. First item
2. Second item
3. Third item`;
      expect(markdownToWhatsApp(markdown)).toBe(expected);
    });

    test('converts links to text only', () => {
      expect(markdownToWhatsApp('[Google](https://google.com)')).toBe('Google');
    });

    test('handles complex markdown', () => {
      const markdown = `# Welcome!

Here's some **bold text** and *italic text*.

- Point 1
- Point 2

Visit [our website](https://example.com) for more info.

\`\`\`
code block
\`\`\`

Some \`inline code\` here.`;

      const result = markdownToWhatsApp(markdown);
      expect(result).toContain('*Welcome!*');
      expect(result).toContain('*bold text*');
      expect(result).toContain('_italic text_');
      expect(result).toContain('• Point 1');
      expect(result).toContain('our website');
    });

    test('handles nested formatting correctly', () => {
      // Test case that reproduces the issue where italic wrapping bold placeholders
      const markdown = '_**word1** **word2** **word3** **word4**_';
      const result = markdownToWhatsApp(markdown);
      expect(result).toBe('_*word1* *word2* *word3* *word4*_');
    });

    test('handles mixed formatting without placeholder conflicts', () => {
      const markdown = 'Normal _italic **bold in italic**_ more text';
      const result = markdownToWhatsApp(markdown);
      expect(result).toBe('Normal _italic *bold in italic*_ more text');
    });

    test('preserves quiz placeholders with multiple underscores', () => {
      const quizText = 'Ayer, yo ______ (trabajar) en un proyecto importante. Mi amigo ______ (ayudar) con algunas ideas. Después, nosotros ______ (comer) en un restaurante. La comida ______ (ser) deliciosa. Más tarde, ellos ______ (decidir) ir al cine.';
      const result = markdownToWhatsApp(quizText);
      expect(result).toBe('Ayer, yo ______ (trabajar) en un proyecto importante. Mi amigo ______ (ayudar) con algunas ideas. Después, nosotros ______ (comer) en un restaurante. La comida ______ (ser) deliciosa. Más tarde, ellos ______ (decidir) ir al cine.');
    });

    test('handles quiz placeholders mixed with other formatting', () => {
      const mixedText = 'Complete the sentence: I ______ (love) **learning** languages. The word ______ (beautiful) is _really_ nice.';
      const result = markdownToWhatsApp(mixedText);
      expect(result).toBe('Complete the sentence: I ______ (love) *learning* languages. The word ______ (beautiful) is _really_ nice.');
    });
  });

  describe('splitMessageBySeparator', () => {
    test('splits message by default separator', () => {
      const message = 'Part 1\n---\nPart 2\n---\nPart 3';
      const result = splitMessageBySeparator(message);
      expect(result).toEqual(['Part 1', 'Part 2', 'Part 3']);
    });

    test('splits message by custom separator', () => {
      const message = 'Part 1|||Part 2|||Part 3';
      const result = splitMessageBySeparator(message, '|||');
      expect(result).toEqual(['Part 1', 'Part 2', 'Part 3']);
    });

    test('handles empty parts', () => {
      const message = 'Part 1\n---\n\n---\nPart 3';
      const result = splitMessageBySeparator(message);
      expect(result).toEqual(['Part 1', 'Part 3']);
    });

    test('returns single message when no separator found', () => {
      const message = 'Single message without separator';
      const result = splitMessageBySeparator(message);
      expect(result).toEqual(['Single message without separator']);
    });
  });

  describe('processMarkdownForWhatsApp', () => {
    test('converts markdown and splits by separator', () => {
      const markdown = `**Bold intro**
---
*Italic middle*
---
~~Strikethrough end~~`;
      
      const result = processMarkdownForWhatsApp(markdown);
      expect(result).toEqual([
        '*Bold intro*',
        '_Italic middle_',
        '~Strikethrough end~'
      ]);
    });

    test('handles complex markdown with separators', () => {
      const markdown = `# Welcome Message

Here's your **lesson plan**:
- Point 1
- Point 2

---

## Exercise Section

Try this example:
\`\`\`
const hello = "world";
\`\`\`

---

That's all for today!`;

      const result = processMarkdownForWhatsApp(markdown);
      expect(result).toHaveLength(3);
      expect(result[0]).toContain('*Welcome Message*');
      expect(result[0]).toContain('*lesson plan*');
      expect(result[1]).toContain('*Exercise Section*');
      expect(result[2]).toBe("That's all for today!");
    });
  });
});
