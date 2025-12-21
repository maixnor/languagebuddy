import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./blogs" }),
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    author: z.string().default('LanguageBuddy Team'),
    image: image().optional(),
    tags: z.array(z.string()).default([]),
    lang: z.enum(['en', 'es', 'fr', 'de']).default('en'),
  }),
});

export const collections = { blog };
