import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BookmarkService } from './bookmark-service.js';
import type { BookmarkRepository, MetadataExtractor, TagGenerator } from '../interfaces/index.js';
import type { BookmarkCreateRequest, BookmarkMetadata } from '@bookmark-slack-bot/shared/types';

describe('BookmarkService', () => {
  let bookmarkService: BookmarkService;
  let mockRepository: BookmarkRepository;
  let mockMetadataExtractor: MetadataExtractor;
  let mockTagGenerator: TagGenerator;

  beforeEach(() => {
    // Mock repository
    mockRepository = {
      save: vi.fn(),
      findById: vi.fn(),
      findByUrl: vi.fn(),
      search: vi.fn(),
      delete: vi.fn(),
      getRecentBookmarks: vi.fn(),
      getSeedTags: vi.fn(),
      getExistingTags: vi.fn(),
      getPopularTags: vi.fn(),
    };

    // Mock metadata extractor
    mockMetadataExtractor = {
      extractMetadata: vi.fn(),
    };

    // Mock tag generator
    mockTagGenerator = {
      generateTags: vi.fn(),
    };

    bookmarkService = new BookmarkService(
      mockRepository,
      mockMetadataExtractor,
      mockTagGenerator
    );
  });

  describe('createBookmark', () => {
    it('should create a new bookmark successfully', async () => {
      // Arrange
      const request: BookmarkCreateRequest = {
        url: 'https://example.com',
        userId: 'user123',
        channelId: 'channel123',
        manualTags: ['javascript', 'tutorial']
      };

      const mockMetadata: BookmarkMetadata = {
        title: 'Example Tutorial',
        description: 'A great JavaScript tutorial',
        url: 'https://example.com',
        extractedAt: new Date()
      };

      const expectedBookmark = {
        id: 1,
        url: 'https://example.com',
        title: 'Example Tutorial',
        description: 'A great JavaScript tutorial',
        tags: ['javascript', 'tutorial', 'react', 'frontend'],
        userId: 'user123',
        channelId: 'channel123',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Setup mocks
      vi.mocked(mockRepository.findByUrl).mockResolvedValue(null);
      vi.mocked(mockMetadataExtractor.extractMetadata).mockResolvedValue(mockMetadata);
      vi.mocked(mockRepository.getSeedTags).mockResolvedValue(['react', 'javascript', 'node']);
      vi.mocked(mockTagGenerator.generateTags).mockResolvedValue(['react', 'frontend']);
      vi.mocked(mockRepository.save).mockResolvedValue(expectedBookmark);

      // Act
      const result = await bookmarkService.createBookmark(request);

      // Assert
      expect(result).toEqual(expectedBookmark);
      expect(mockRepository.findByUrl).toHaveBeenCalledWith('https://example.com', 'user123');
      expect(mockMetadataExtractor.extractMetadata).toHaveBeenCalledWith('https://example.com');
      expect(mockTagGenerator.generateTags).toHaveBeenCalledWith(
        'Example Tutorial A great JavaScript tutorial',
        ['react', 'javascript', 'node']
      );
      expect(mockRepository.save).toHaveBeenCalledWith({
        url: 'https://example.com',
        title: 'Example Tutorial',
        description: 'A great JavaScript tutorial',
        tags: ['javascript', 'tutorial', 'react', 'frontend'], // Manual + generated, deduplicated
        userId: 'user123',
        channelId: 'channel123'
      });
    });

    it('should return existing bookmark if URL already exists for user', async () => {
      // Arrange
      const request: BookmarkCreateRequest = {
        url: 'https://example.com',
        userId: 'user123',
        channelId: 'channel123',
      };

      const existingBookmark = {
        id: 1,
        url: 'https://example.com',
        title: 'Existing Bookmark',
        description: 'Already saved',
        tags: ['existing'],
        userId: 'user123',
        channelId: 'channel123',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.mocked(mockRepository.findByUrl).mockResolvedValue(existingBookmark);

      // Act
      const result = await bookmarkService.createBookmark(request);

      // Assert
      expect(result).toEqual(existingBookmark);
      expect(mockRepository.findByUrl).toHaveBeenCalledWith('https://example.com', 'user123');
      expect(mockMetadataExtractor.extractMetadata).not.toHaveBeenCalled();
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should handle validation errors', async () => {
      // Arrange
      const invalidRequest: BookmarkCreateRequest = {
        url: '', // Invalid empty URL
        userId: 'user123',
        channelId: 'channel123',
      };

      // Act & Assert
      await expect(bookmarkService.createBookmark(invalidRequest)).rejects.toThrow('URL is required');
    });

    it('should deduplicate tags correctly', async () => {
      // Arrange
      const request: BookmarkCreateRequest = {
        url: 'https://example.com',
        userId: 'user123',
        channelId: 'channel123',
        manualTags: ['javascript', 'tutorial', 'react'] // 'react' will be generated too
      };

      const mockMetadata: BookmarkMetadata = {
        title: 'Test',
        description: 'Test desc',
        url: 'https://example.com',
        extractedAt: new Date()
      };

      const expectedBookmark = {
        id: 1,
        url: 'https://example.com',
        title: 'Test',
        description: 'Test desc',
        tags: ['javascript', 'tutorial', 'react'], // Should be deduplicated
        userId: 'user123',
        channelId: 'channel123',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Setup mocks
      vi.mocked(mockRepository.findByUrl).mockResolvedValue(null);
      vi.mocked(mockMetadataExtractor.extractMetadata).mockResolvedValue(mockMetadata);
      vi.mocked(mockRepository.getSeedTags).mockResolvedValue([]);
      vi.mocked(mockTagGenerator.generateTags).mockResolvedValue(['react', 'frontend']); // 'react' is duplicate
      vi.mocked(mockRepository.save).mockResolvedValue(expectedBookmark);

      // Act
      await bookmarkService.createBookmark(request);

      // Assert
      expect(mockRepository.save).toHaveBeenCalledWith({
        url: 'https://example.com',
        title: 'Test',
        description: 'Test desc',
        tags: ['javascript', 'tutorial', 'react', 'frontend'], // Deduplicated
        userId: 'user123',
        channelId: 'channel123'
      });
    });
  });

  describe('searchBookmarks', () => {
    it('should search bookmarks with filters', async () => {
      // Arrange
      const filters = {
        userId: 'user123',
        query: 'javascript',
        limit: 10
      };

      const expectedResult = {
        bookmarks: [
          {
            id: 1,
            url: 'https://example.com',
            title: 'JS Tutorial',
            description: 'Great tutorial',
            tags: ['javascript'],
            userId: 'user123',
            channelId: 'channel123',
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ],
        total: 1,
        query: 'test'
      };

      vi.mocked(mockRepository.search).mockResolvedValue(expectedResult);

      // Act
      const result = await bookmarkService.searchBookmarks(filters);

      // Assert
      expect(result).toEqual(expectedResult);
      expect(mockRepository.search).toHaveBeenCalledWith(filters);
    });
  });
});