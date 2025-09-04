import type { BookmarkMetadata } from '@bookmark-slack-bot/shared/types';

export interface MetadataExtractor {
  extractMetadata(url: string): Promise<BookmarkMetadata>;
}