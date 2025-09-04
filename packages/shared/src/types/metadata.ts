export interface WebMetadata {
  title: string;
  description: string;
  url: string;
  extractionMethod: 'og' | 'twitter' | 'meta' | 'extracted' | 'fallback' | 'timeout_fallback' | 'error_fallback';
  statusCode?: number;
  contentLength?: number;
}

export interface MetadataExtractionOptions {
  timeout?: number;
  userAgent?: string;
  followRedirects?: boolean;
}

export interface BookmarkMetadata {
  title: string;
  description: string;
  url: string;
  statusCode?: number;
  extractedAt: Date;
  imageUrl?: string;
}