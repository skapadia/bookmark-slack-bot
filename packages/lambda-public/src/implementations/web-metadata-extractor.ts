import fetch from 'node-fetch';
import type { MetadataExtractor } from '@bookmark-slack-bot/core/interfaces';
import type { BookmarkMetadata } from '@bookmark-slack-bot/shared/types';
import { ExternalServiceError, logger } from '@bookmark-slack-bot/shared';

export class WebMetadataExtractor implements MetadataExtractor {
  // private readonly timeout: number = 10000; // 10 seconds - currently unused

  async extractMetadata(url: string): Promise<BookmarkMetadata> {
    logger.info({ url }, 'Extracting metadata from URL');

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BookmarkBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
        },
        // timeout: this.timeout, // timeout removed - not supported in RequestInit
        follow: 5, // Follow up to 5 redirects
        size: 1024 * 1024, // 1MB limit
      });

      if (!response.ok) {
        throw new ExternalServiceError(`HTTP ${response.status}: ${response.statusText}`, 'web-fetch');
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        logger.warn({ url, contentType }, 'Non-HTML content type detected');
        return this.createFallbackMetadata(url);
      }

      const html = await response.text();
      const metadata = this.parseHtmlMetadata(html, url);

      logger.info({ 
        url, 
        titleLength: metadata.title?.length, 
        descriptionLength: metadata.description?.length 
      }, 'Metadata extracted successfully');

      return metadata;

    } catch (error) {
      if (error instanceof ExternalServiceError) {
        throw error;
      }

      logger.error({ url, error }, 'Failed to extract metadata');
      
      // Return fallback metadata instead of throwing
      return this.createFallbackMetadata(url);
    }
  }

  private parseHtmlMetadata(html: string, url: string): BookmarkMetadata {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    let title = titleMatch?.[1]?.trim() || '';

    // Try Open Graph title if no title found
    if (!title) {
      const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']*)/i);
      title = ogTitleMatch?.[1]?.trim() || '';
    }

    // Extract description
    let description = '';

    // Try meta description first
    const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)/i);
    description = metaDescMatch?.[1]?.trim() || '';

    // Try Open Graph description if no meta description
    if (!description) {
      const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']*)/i);
      description = ogDescMatch?.[1]?.trim() || '';
    }

    // Try Twitter description if still no description
    if (!description) {
      const twitterDescMatch = html.match(/<meta\s+name=["']twitter:description["']\s+content=["']([^"']*)/i);
      description = twitterDescMatch?.[1]?.trim() || '';
    }

    // Extract image URL for richer bookmark display
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']*)/i);
    const imageUrl = ogImageMatch?.[1]?.trim();

    // Clean up HTML entities
    title = this.decodeHtmlEntities(title);
    description = this.decodeHtmlEntities(description);

    // Fallback to URL-based title if still empty
    if (!title) {
      title = this.createTitleFromUrl(url);
    }

    const metadata: BookmarkMetadata = {
      title: title.substring(0, 500), // Limit title length
      description: description.substring(0, 1000), // Limit description length
      url,
      extractedAt: new Date()
    };

    if (imageUrl) {
      metadata.imageUrl = imageUrl;
    }

    return metadata;
  }

  private createFallbackMetadata(url: string): BookmarkMetadata {
    return {
      title: this.createTitleFromUrl(url),
      description: '',
      url,
      extractedAt: new Date()
    };
  }

  private createTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace(/^www\./, '');
      const pathname = urlObj.pathname.replace(/\/$/, '');
      
      if (pathname && pathname !== '/') {
        const segments = pathname.split('/').filter(Boolean);
        const lastSegment = segments[segments.length - 1];
        return `${lastSegment} - ${hostname}`;
      }
      
      return hostname;
    } catch {
      return 'Untitled Bookmark';
    }
  }

  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
      '&nbsp;': ' ',
      '&#8212;': '—', // em dash
      '&#8211;': '–', // en dash
      '&#8220;': '"', // left double quotation mark
      '&#8221;': '"', // right double quotation mark
      '&#8217;': "'", // right single quotation mark
      '&#8216;': "'"  // left single quotation mark
    };

    return text.replace(/&(?:#39|#x27|apos|amp|lt|gt|quot|nbsp|#8212|#8211|#8220|#8221|#8217|#8216);/g, (match) => {
      return entities[match] || match;
    });
  }
}