import type { Bookmark, BookmarkSearchFilters } from '@bookmark-slack-bot/shared/types';

// Public Lambda operations (external services)
export type PublicLambdaOperation = 
  | 'processBookmark'
  | 'searchBookmarks'
  | 'generateTags';

// Private Lambda operations (database)
export type PrivateLambdaOperation = 
  | 'saveBookmark'
  | 'findByUrl'
  | 'getSeedTags' 
  | 'searchBookmarks'
  | 'deleteBookmark'
  | 'initializeSchema'
  | 'getRecentBookmarks'
  | 'getExistingTags'
  | 'getPopularTags'
  | 'createBookmarkComplete';

// Specific payload interfaces for type safety
export interface SaveBookmarkPayload extends Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'> {}

export interface SearchBookmarksPayload extends BookmarkSearchFilters {}

export interface FindByIdPayload {
  id: number;
}

export interface FindByUrlPayload {
  url: string;
  userId: string;
}

export interface GetRecentBookmarksPayload {
  userId: string;
  limit?: number;
}

export interface GetSeedTagsPayload {
  userId: string;
  teamId?: string;
  limit?: number;
}

export interface GetExistingTagsPayload {
  teamId: string;
}

export interface GetPopularTagsPayload {
  teamId: string;
  limit?: number;
}

export interface DeleteBookmarkPayload {
  id: number;
  userId: string;
}

export interface CreateBookmarkCompletePayload {
  url: string;
  title: string;
  description: string;
  userId: string;
  teamId: string;
  channelId: string;
  manualTags?: string[];
}

// Union type for all possible payloads
export type LambdaPayload = 
  | SaveBookmarkPayload
  | SearchBookmarksPayload 
  | FindByIdPayload
  | FindByUrlPayload
  | GetRecentBookmarksPayload
  | GetSeedTagsPayload
  | GetExistingTagsPayload
  | GetPopularTagsPayload
  | DeleteBookmarkPayload
  | CreateBookmarkCompletePayload;

// Generic Lambda request/response types
export interface LambdaRequest<T = LambdaPayload> {
  operation: PublicLambdaOperation | PrivateLambdaOperation;
  payload?: T;
}

export interface LambdaResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}