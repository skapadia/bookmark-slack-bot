export interface Bookmark {
  id?: number;
  url: string;
  title: string;
  description: string;
  tags: string[];
  manualTags?: string[];
  userId: string;
  teamId?: string;
  channelId: string;
  isPrivate?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BookmarkCreateRequest {
  url: string;
  title?: string;
  description?: string;
  manualTags?: string[];
  userId: string;
  teamId?: string;
  channelId: string;
}

export interface BookmarkSearchRequest {
  query: string;
  userId: string;
  channelId?: string;
  limit?: number;
}

export interface BookmarkSearchResult {
  bookmarks: Bookmark[];
  total: number;
  query: string;
}

export interface BookmarkSearchFilters {
  query?: string;
  userId: string;
  teamId?: string;
  channelId?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}