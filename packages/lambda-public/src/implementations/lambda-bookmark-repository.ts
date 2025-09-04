import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { BookmarkRepository } from '@bookmark-slack-bot/core/interfaces';
import type { 
  Bookmark, 
  BookmarkSearchFilters, 
  BookmarkSearchResult
} from '@bookmark-slack-bot/shared/types';
import type {
  LambdaRequest,
  LambdaResponse,
  PrivateLambdaOperation 
} from '@bookmark-slack-bot/api-contracts';
import { LambdaError, logger } from '@bookmark-slack-bot/shared';
import { lambdaConfig } from '@bookmark-slack-bot/shared/config';

export class LambdaBookmarkRepository implements BookmarkRepository {
  private client: LambdaClient;

  constructor() {
    this.client = new LambdaClient({ 
      region: lambdaConfig.region,
      ...(lambdaConfig.profile && { profile: lambdaConfig.profile })
    });
  }

  async save(bookmark: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>): Promise<Bookmark> {
    return this.invokeLambda<typeof bookmark, Bookmark>('saveBookmark', bookmark);
  }

  async findById(id: number): Promise<Bookmark | null> {
    return this.invokeLambda<{ id: number }, Bookmark | null>('searchBookmarks', { id });
  }

  async findByUrl(url: string, userId: string): Promise<Bookmark | null> {
    return await this.invokeLambda<{ url: string; userId: string }, Bookmark | null>(
      'findByUrl', 
      { url, userId }
    );
  }

  async search(filters: BookmarkSearchFilters): Promise<BookmarkSearchResult> {
    return this.invokeLambda<BookmarkSearchFilters, BookmarkSearchResult>('searchBookmarks', filters);
  }

  async delete(id: number, userId: string): Promise<boolean> {
    return this.invokeLambda<{ id: number; userId: string }, boolean>('deleteBookmark', { id, userId });
  }

  async getRecentBookmarks(userId: string, limit = 10): Promise<Bookmark[]> {
    return this.invokeLambda<{ userId: string; limit: number }, Bookmark[]>(
      'getRecentBookmarks', 
      { userId, limit }
    );
  }

  async getSeedTags(userId: string, teamId?: string, limit = 20): Promise<string[]> {
    return this.invokeLambda<{ userId: string; teamId?: string; limit: number }, string[]>(
      'getSeedTags', 
      { userId, ...(teamId && { teamId }), limit }
    );
  }

  async getExistingTags(teamId: string): Promise<string[]> {
    return this.invokeLambda<{ teamId: string }, string[]>(
      'getExistingTags', 
      { teamId }
    );
  }

  async getPopularTags(teamId: string, limit = 20): Promise<{tagName: string, usageCount: number}[]> {
    return this.invokeLambda<{ teamId: string; limit: number }, {tagName: string, usageCount: number}[]>(
      'getPopularTags', 
      { teamId, limit }
    );
  }

  private async invokeLambda<T, R>(operation: PrivateLambdaOperation, payload: T): Promise<R> {
    logger.info({ operation }, 'Invoking private Lambda');

    const request: LambdaRequest<T> = {
      operation,
      payload
    };

    try {
      const command = new InvokeCommand({
        FunctionName: lambdaConfig.privateLambdaName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify(request)
      });

      const response = await this.client.send(command);

      if (!response.Payload) {
        throw new LambdaError('Empty response from private Lambda');
      }

      const responseStr = Buffer.from(response.Payload).toString();
      const lambdaResponse: LambdaResponse<R> = JSON.parse(responseStr);

      if (!lambdaResponse.success) {
        throw new LambdaError(`Private Lambda error: ${lambdaResponse.error}`);
      }

      logger.info({ operation }, 'Private Lambda invocation successful');
      return lambdaResponse.data as R;

    } catch (error) {
      if (error instanceof LambdaError) {
        throw error;
      }

      logger.error({ operation, error }, 'Failed to invoke private Lambda');
      throw new LambdaError(`Lambda invocation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}