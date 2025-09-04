import type { Bookmark, BookmarkSearchFilters, BookmarkSearchResult } from '@bookmark-slack-bot/shared/types';

export interface BookmarkRepository {
  save(bookmark: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>): Promise<Bookmark>;
  findById(id: number): Promise<Bookmark | null>;
  findByUrl(url: string, userId: string): Promise<Bookmark | null>;
  search(filters: BookmarkSearchFilters): Promise<BookmarkSearchResult>;
  delete(id: number, userId: string): Promise<boolean>;
  getRecentBookmarks(userId: string, limit?: number): Promise<Bookmark[]>;
  getSeedTags(userId: string, teamId?: string, limit?: number): Promise<string[]>;
  getExistingTags(teamId: string): Promise<string[]>;
  getPopularTags(teamId: string, limit?: number): Promise<{tagName: string, usageCount: number}[]>;
}