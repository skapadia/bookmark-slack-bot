import type { Handler } from 'aws-lambda';
import type { 
  LambdaRequest, 
  LambdaResponse, 
  SaveBookmarkPayload,
  SearchBookmarksPayload,
  FindByIdPayload,
  FindByUrlPayload,
  GetRecentBookmarksPayload,
  GetSeedTagsPayload,
  GetExistingTagsPayload,
  GetPopularTagsPayload,
  DeleteBookmarkPayload,
  CreateBookmarkCompletePayload
} from '@bookmark-slack-bot/api-contracts';
import { PostgresBookmarkRepository } from '../implementations/postgres-bookmark-repository.js';
import { SophisticatedBedrockTagGenerator } from '../implementations/sophisticated-bedrock-tag-generator.js';
import { CompleteBookmarkService } from '../implementations/complete-bookmark-service.js';
import { createServiceLogger } from '@bookmark-slack-bot/shared';

const logger = createServiceLogger('database-handler');

// Initialize repository and services
const bookmarkRepository = new PostgresBookmarkRepository();
const tagGenerator = new SophisticatedBedrockTagGenerator(bookmarkRepository);
const completeBookmarkService = new CompleteBookmarkService(bookmarkRepository, tagGenerator);

export const handler: Handler<LambdaRequest, LambdaResponse> = async (event: LambdaRequest): Promise<LambdaResponse> => {
  logger.info({ operation: event.operation }, 'Database Lambda invoked');

  try {
    let result: any;

    switch (event.operation) {
      case 'saveBookmark': {
        const payload = event.payload as SaveBookmarkPayload;
        result = await bookmarkRepository.save(payload);
        break;
      }

      case 'findByUrl': {
        const payload = event.payload as FindByUrlPayload;
        result = await bookmarkRepository.findByUrl(payload.url, payload.userId);
        break;
      }

      case 'searchBookmarks': {
        // Check if this is a search by ID or general search
        const payload = event.payload as SearchBookmarksPayload | FindByIdPayload;
        if ('id' in payload && payload.id) {
          // Search by ID
          result = await bookmarkRepository.findById(payload.id);
        } else {
          // General search
          result = await bookmarkRepository.search(payload as SearchBookmarksPayload);
        }
        break;
      }

      case 'getRecentBookmarks': {
        const payload = event.payload as GetRecentBookmarksPayload;
        result = await bookmarkRepository.getRecentBookmarks(
          payload.userId,
          payload.limit
        );
        break;
      }

      case 'getSeedTags': {
        const payload = event.payload as GetSeedTagsPayload;
        result = await bookmarkRepository.getSeedTags(
          payload.userId,
          payload.teamId,
          payload.limit
        );
        break;
      }

      case 'getExistingTags': {
        const payload = event.payload as GetExistingTagsPayload;
        result = await bookmarkRepository.getExistingTags(payload.teamId);
        break;
      }

      case 'getPopularTags': {
        const payload = event.payload as GetPopularTagsPayload;
        result = await bookmarkRepository.getPopularTags(
          payload.teamId,
          payload.limit
        );
        break;
      }

      case 'deleteBookmark': {
        const payload = event.payload as DeleteBookmarkPayload;
        result = await bookmarkRepository.delete(
          payload.id,
          payload.userId
        );
        break;
      }

      case 'createBookmarkComplete': {
        const payload = event.payload as CreateBookmarkCompletePayload;
        result = await completeBookmarkService.createBookmarkComplete(payload);
        break;
      }

      case 'initializeSchema':
        result = await initializeSchema();
        break;

      default:
        throw new Error(`Unknown operation: ${event.operation}`);
    }

    logger.info({ operation: event.operation }, 'Database operation completed successfully');

    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    logger.error({ operation: event.operation, error }, 'Database operation failed');

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    };
  }
};

// Schema initialization function
async function initializeSchema(): Promise<{ message: string }> {
  logger.info('Initializing database schema');

  // Get a client using the repository's pool
  const pool = await (bookmarkRepository as any).getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Drop existing table to wipe data (for clean development setup)
    await client.query('DROP TABLE IF EXISTS bookmarks CASCADE');

    // Create bookmarks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id SERIAL PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        tags JSONB NOT NULL DEFAULT '[]',
        manual_tags JSONB DEFAULT NULL,
        user_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        is_private BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Performance indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookmarks_user 
      ON bookmarks(user_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookmarks_team 
      ON bookmarks(team_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookmarks_tags 
      ON bookmarks USING gin(tags)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookmarks_text 
      ON bookmarks USING gin(
        to_tsvector('english', title || ' ' || COALESCE(description, ''))
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookmarks_url 
      ON bookmarks(url)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at 
      ON bookmarks (created_at DESC)
    `);

    // Materialized view for efficient tag queries
    await client.query(`
      DROP MATERIALIZED VIEW IF EXISTS team_tags
    `);

    await client.query(`
      CREATE MATERIALIZED VIEW team_tags AS
      SELECT 
        team_id,
        jsonb_array_elements_text(tags) as tag_name,
        COUNT(*) as usage_count,
        MAX(updated_at) as last_used
      FROM bookmarks 
      WHERE jsonb_array_length(tags) > 0
      GROUP BY team_id, jsonb_array_elements_text(tags)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_team_tags_team 
      ON team_tags(team_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_team_tags_name 
      ON team_tags(tag_name)
    `);

    // Create updated_at trigger function
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS update_bookmarks_updated_at ON bookmarks
    `);

    await client.query(`
      CREATE TRIGGER update_bookmarks_updated_at 
      BEFORE UPDATE ON bookmarks 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);

    // Trigger to refresh materialized view on bookmark changes
    await client.query(`
      CREATE OR REPLACE FUNCTION refresh_team_tags() 
      RETURNS TRIGGER AS $$
      BEGIN
        REFRESH MATERIALIZED VIEW team_tags;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS refresh_team_tags_trigger ON bookmarks
    `);

    await client.query(`
      CREATE TRIGGER refresh_team_tags_trigger
        AFTER INSERT OR UPDATE OR DELETE ON bookmarks
        FOR EACH STATEMENT
        EXECUTE FUNCTION refresh_team_tags()
    `);

    await client.query('COMMIT');

    logger.info('Database schema initialized successfully');
    return { message: 'Database schema initialized successfully' };

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to initialize database schema');
    throw error;
  } finally {
    client.release();
  }
}