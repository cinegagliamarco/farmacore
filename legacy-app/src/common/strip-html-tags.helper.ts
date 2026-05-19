import * as cheerio from 'cheerio';

export const stripHtmlTags = (html: string): string => {
  if (!html) return '';

  // Use cheerio to parse and extract text content, removing all HTML tags
  const $ = cheerio.load(html);
  return $.root().text().trim();
};
