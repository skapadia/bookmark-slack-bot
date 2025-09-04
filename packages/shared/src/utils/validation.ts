import type { Bookmark, BookmarkCreateRequest } from '../types/bookmark.js';

// ValidationError moved to errors/index.ts to avoid duplicate exports
import { ValidationError } from '../errors/index.js';

export const validateUrl = (url: string): boolean => {
  try {
    new URL(url);
    return url.startsWith('http://') || url.startsWith('https://');
  } catch {
    return false;
  }
};

export const validateBookmarkCreateRequest = (request: BookmarkCreateRequest): void => {
  if (!request.url) {
    throw new ValidationError('URL is required', 'url');
  }

  if (!validateUrl(request.url)) {
    throw new ValidationError('Invalid URL format', 'url');
  }

  if (!request.userId || request.userId.trim().length === 0) {
    throw new ValidationError('User ID is required', 'userId');
  }

  if (!request.channelId || request.channelId.trim().length === 0) {
    throw new ValidationError('Channel ID is required', 'channelId');
  }

  if (request.manualTags && request.manualTags.length > 10) {
    throw new ValidationError('Too many manual tags (max 10)', 'manualTags');
  }

  // Validate individual tags
  if (request.manualTags) {
    for (const tag of request.manualTags) {
      if (!tag || tag.trim().length === 0) {
        throw new ValidationError('Empty tags are not allowed', 'manualTags');
      }
      if (tag.length > 50) {
        throw new ValidationError('Tag too long (max 50 characters)', 'manualTags');
      }
    }
  }
};

export const sanitizeBookmark = (bookmark: Partial<Bookmark>) => {
  const result: Partial<Bookmark> = {
    ...bookmark,
    tags: bookmark.tags?.map(tag => tag.trim().toLowerCase()).filter(Boolean) || [],
  };
  
  if (bookmark.manualTags) {
    result.manualTags = bookmark.manualTags.map(tag => tag.trim().toLowerCase()).filter(Boolean);
  }
  
  if (bookmark.title !== undefined) {
    result.title = bookmark.title.trim();
  }
  
  if (bookmark.description !== undefined) {
    result.description = bookmark.description.trim();
  }
  
  if (bookmark.userId !== undefined) {
    result.userId = bookmark.userId.trim();
  }
  
  if (bookmark.channelId !== undefined) {
    result.channelId = bookmark.channelId.trim();
  }
  
  if (bookmark.teamId !== undefined) {
    result.teamId = bookmark.teamId.trim();
  }
  
  return result;
};