import type { 
  Bookmark, 
  BookmarkCreateRequest, 
  BookmarkSearchFilters, 
  BookmarkSearchResult 
} from '@bookmark-slack-bot/shared/types';
import { 
  validateBookmarkCreateRequest, 
  sanitizeBookmark, 
  NotFoundError,
  logger 
} from '@bookmark-slack-bot/shared';
import type { BookmarkRepository, MetadataExtractor, TagGenerator } from '../interfaces/index.js';

export class BookmarkService {
  constructor(
    private readonly bookmarkRepository: BookmarkRepository,
    private readonly metadataExtractor: MetadataExtractor,
    private readonly tagGenerator: TagGenerator
  ) {}

  async createBookmark(request: BookmarkCreateRequest): Promise<Bookmark> {
    logger.info({ url: request.url }, 'Creating bookmark');
    
    validateBookmarkCreateRequest(request);

    // Check if bookmark already exists for this user
    const existing = await this.bookmarkRepository.findByUrl(request.url, request.userId);
    if (existing) {
      logger.info({ bookmarkId: existing.id }, 'Bookmark already exists');
      return existing;
    }

    // Extract metadata from the URL
    const metadata = await this.metadataExtractor.extractMetadata(request.url);
    
    // Generate AI tags if no manual tags provided, or supplement manual tags
    const contentForTagGeneration = `${metadata.title} ${metadata.description}`.trim();
    const teamId = request.teamId || request.userId; // Use teamId if provided, fallback to userId
    const existingTags = await this.bookmarkRepository.getSeedTags(request.userId, teamId, 20);
    
    const generatedTags = await this.tagGenerator.generateTags(contentForTagGeneration, existingTags, {
      url: request.url,
      title: metadata.title,
      description: metadata.description,
      teamId: teamId,
      ...(request.manualTags && { manualTags: request.manualTags })
    });
    
    // Combine manual tags with generated tags
    const allTags = [
      ...(request.manualTags || []),
      ...generatedTags
    ];
    
    // Remove duplicates and sanitize
    const uniqueTags = [...new Set(allTags)];
    
    const bookmarkData = sanitizeBookmark({
      url: request.url,
      title: metadata.title || 'Untitled',
      description: metadata.description || '',
      tags: uniqueTags,
      ...(request.manualTags && { manualTags: request.manualTags }),
      userId: request.userId,
      teamId: teamId,
      channelId: request.channelId
    });

    const savedBookmark = await this.bookmarkRepository.save(bookmarkData as Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>);
    
    logger.info({ bookmarkId: savedBookmark.id }, 'Bookmark created successfully');
    return savedBookmark;
  }

  async searchBookmarks(filters: BookmarkSearchFilters): Promise<BookmarkSearchResult> {
    logger.info({ filters }, 'Searching bookmarks');
    return this.bookmarkRepository.search(filters);
  }

  async getBookmark(id: number): Promise<Bookmark> {
    const bookmark = await this.bookmarkRepository.findById(id);
    if (!bookmark) {
      throw new NotFoundError(`Bookmark with ID ${id} not found`);
    }
    return bookmark;
  }

  async deleteBookmark(id: number, userId: string): Promise<void> {
    const deleted = await this.bookmarkRepository.delete(id, userId);
    if (!deleted) {
      throw new NotFoundError(`Bookmark with ID ${id} not found or not owned by user`);
    }
    logger.info({ bookmarkId: id }, 'Bookmark deleted successfully');
  }

  async getRecentBookmarks(userId: string, limit = 10): Promise<Bookmark[]> {
    return this.bookmarkRepository.getRecentBookmarks(userId, limit);
  }
}