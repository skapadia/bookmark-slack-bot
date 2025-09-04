import type { Bookmark } from '@bookmark-slack-bot/shared/types';
import type { CreateBookmarkCompletePayload } from '@bookmark-slack-bot/api-contracts/lambda';
import { 
  sanitizeBookmark, 
  logger 
} from '@bookmark-slack-bot/shared';
import type { BookmarkRepository, TagGenerator } from '@bookmark-slack-bot/core/interfaces';

export class CompleteBookmarkService {
  constructor(
    private readonly bookmarkRepository: BookmarkRepository,
    private readonly tagGenerator: TagGenerator
  ) {}

  async createBookmarkComplete(payload: CreateBookmarkCompletePayload): Promise<Bookmark> {
    logger.info({ url: payload.url, userId: payload.userId, teamId: payload.teamId }, 'Creating complete bookmark');
    
    // Check if bookmark already exists for this user
    const existing = await this.bookmarkRepository.findByUrl(payload.url, payload.userId);
    if (existing) {
      logger.info({ bookmarkId: existing.id }, 'Bookmark already exists');
      return existing;
    }

    // Generate AI tags using the provided metadata (no metadata extraction needed)
    const contentForTagGeneration = `${payload.title} ${payload.description}`.trim();
    const existingTags = await this.bookmarkRepository.getSeedTags(payload.userId, payload.teamId, 20);
    
    const generatedTags = await this.tagGenerator.generateTags(contentForTagGeneration, existingTags, {
      url: payload.url,
      title: payload.title,
      description: payload.description,
      teamId: payload.teamId,
      ...(payload.manualTags && { manualTags: payload.manualTags })
    });
    
    // Combine manual tags with generated tags
    const allTags = [
      ...(payload.manualTags || []),
      ...generatedTags
    ];
    
    // Remove duplicates and sanitize
    const uniqueTags = [...new Set(allTags)];
    
    const bookmarkData = sanitizeBookmark({
      url: payload.url,
      title: payload.title || 'Untitled',
      description: payload.description || '',
      tags: uniqueTags,
      ...(payload.manualTags && { manualTags: payload.manualTags }),
      userId: payload.userId,
      teamId: payload.teamId,
      channelId: payload.channelId
    });

    const savedBookmark = await this.bookmarkRepository.save(bookmarkData as Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>);
    
    logger.info({ bookmarkId: savedBookmark.id }, 'Complete bookmark created successfully');
    return savedBookmark;
  }
}