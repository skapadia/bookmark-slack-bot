import { Pool } from 'pg';
import type { BookmarkRepository } from '@bookmark-slack-bot/core/interfaces';
import type { Bookmark, BookmarkSearchFilters, BookmarkSearchResult } from '@bookmark-slack-bot/shared/types';
import { DatabaseError, logger } from '@bookmark-slack-bot/shared';
import { getDatabaseCredentials } from '../utils/secrets.js';

export class PostgresBookmarkRepository implements BookmarkRepository {
  private pool: Pool | null = null;

  private async getPool(): Promise<Pool> {
    if (!this.pool) {
      const credentials = await getDatabaseCredentials();
      
      this.pool = new Pool({
        host: credentials.host,
        port: credentials.port,
        database: credentials.dbname,
        user: credentials.username,
        password: credentials.password,
        ssl: {
          rejectUnauthorized: false // For AWS RDS
        },
        connectionTimeoutMillis: 30000,
        idleTimeoutMillis: 10000,
        max: 10,
      });

      // Handle pool errors
      this.pool.on('error', (error) => {
        logger.error({ error }, 'Database pool error');
      });
    }

    return this.pool;
  }

  async save(bookmark: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>): Promise<Bookmark> {
    logger.info({ url: bookmark.url, userId: bookmark.userId }, 'Saving bookmark to database');

    const pool = await this.getPool();
    const client = await pool.connect();
    
    try {
      const query = `
        INSERT INTO bookmarks (url, title, description, tags, manual_tags, user_id, team_id, channel_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (url) 
        DO UPDATE SET 
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          tags = EXCLUDED.tags,
          manual_tags = EXCLUDED.manual_tags,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id, url, title, description, tags, manual_tags, user_id as "userId", team_id as "teamId", channel_id as "channelId", created_at as "createdAt", updated_at as "updatedAt"
      `;
      
      const values = [
        bookmark.url,
        bookmark.title,
        bookmark.description,
        JSON.stringify(bookmark.tags),
        bookmark.manualTags ? JSON.stringify(bookmark.manualTags) : null,
        bookmark.userId,
        bookmark.teamId || bookmark.userId, // Use userId as teamId fallback for now
        bookmark.channelId
      ];

      const result = await client.query(query, values);
      const savedBookmark = result.rows[0];
      
      // JSONB column returns array directly, no parsing needed

      logger.info({ bookmarkId: savedBookmark.id }, 'Bookmark saved successfully');
      return savedBookmark;

    } catch (error) {
      logger.error({ error, bookmark }, 'Failed to save bookmark');
      throw new DatabaseError(`Failed to save bookmark: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  async findById(id: number): Promise<Bookmark | null> {
    logger.info({ id }, 'Finding bookmark by ID');

    const pool = await this.getPool();
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT id, url, title, description, tags, user_id as "userId", channel_id as "channelId", 
               created_at as "createdAt", updated_at as "updatedAt"
        FROM bookmarks 
        WHERE id = $1
      `;

      const result = await client.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const bookmark = result.rows[0];
      // JSONB column returns array directly, no parsing needed

      return bookmark;

    } catch (error) {
      logger.error({ error, id }, 'Failed to find bookmark by ID');
      throw new DatabaseError(`Failed to find bookmark: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  async findByUrl(url: string, userId: string): Promise<Bookmark | null> {
    logger.info({ url, userId }, 'Finding bookmark by URL and user');

    const pool = await this.getPool();
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT id, url, title, description, tags, user_id as "userId", channel_id as "channelId",
               created_at as "createdAt", updated_at as "updatedAt"
        FROM bookmarks 
        WHERE url = $1 AND user_id = $2
      `;

      const result = await client.query(query, [url, userId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const bookmark = result.rows[0];
      // JSONB column returns array directly, no parsing needed

      return bookmark;

    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        url, 
        userId 
      }, 'Failed to find bookmark by URL');
      throw new DatabaseError(`Failed to find bookmark: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  async search(filters: BookmarkSearchFilters): Promise<BookmarkSearchResult> {
    logger.info({ filters }, 'Searching bookmarks');

    const pool = await this.getPool();
    const client = await pool.connect();
    
    try {
      let baseQuery = `
        SELECT id, url, title, description, tags, user_id as "userId", channel_id as "channelId",
               created_at as "createdAt", updated_at as "updatedAt"
        FROM bookmarks 
        WHERE user_id = $1
      `;
      
      const queryParams: any[] = [filters.userId];
      let paramCount = 1;

      // Add search conditions
      if (filters.query) {
        paramCount++;
        baseQuery += ` AND (
          title ILIKE $${paramCount} OR 
          description ILIKE $${paramCount} OR 
          url ILIKE $${paramCount} OR
          tags::text ILIKE $${paramCount}
        )`;
        queryParams.push(`%${filters.query}%`);
      }

      if (filters.tags && filters.tags.length > 0) {
        paramCount++;
        baseQuery += ` AND tags::jsonb ?| $${paramCount}`;
        queryParams.push(filters.tags);
      }

      // URL search moved to query parameter

      // Add ordering and limit
      baseQuery += ` ORDER BY created_at DESC`;
      
      if (filters.limit) {
        paramCount++;
        baseQuery += ` LIMIT $${paramCount}`;
        queryParams.push(filters.limit);
      }

      if (filters.offset) {
        paramCount++;
        baseQuery += ` OFFSET $${paramCount}`;
        queryParams.push(filters.offset);
      }

      const result = await client.query(baseQuery, queryParams);
      
      const bookmarks = result.rows.map(row => ({
        ...row,
        tags: row.tags
      }));

      // Get total count for pagination
      let countQuery = `SELECT COUNT(*) FROM bookmarks WHERE user_id = $1`;
      const countParams = [filters.userId];
      
      if (filters.query) {
        countQuery += ` AND (title ILIKE $2 OR description ILIKE $2 OR url ILIKE $2 OR tags::text ILIKE $2)`;
        countParams.push(`%${filters.query}%`);
      }

      const countResult = await client.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].count);

      logger.info({ bookmarksFound: bookmarks.length, total }, 'Bookmark search completed');

      return {
        bookmarks,
        total,
        query: filters.query || ''
      };

    } catch (error) {
      logger.error({ error, filters }, 'Failed to search bookmarks');
      throw new DatabaseError(`Failed to search bookmarks: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  async delete(id: number, userId: string): Promise<boolean> {
    logger.info({ id, userId }, 'Deleting bookmark');

    const pool = await this.getPool();
    const client = await pool.connect();
    
    try {
      const query = `DELETE FROM bookmarks WHERE id = $1 AND user_id = $2`;
      const result = await client.query(query, [id, userId]);
      
      const deleted = (result.rowCount || 0) > 0;
      logger.info({ id, deleted }, 'Bookmark deletion completed');
      
      return deleted;

    } catch (error) {
      logger.error({ error, id, userId }, 'Failed to delete bookmark');
      throw new DatabaseError(`Failed to delete bookmark: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  async getRecentBookmarks(userId: string, limit = 10): Promise<Bookmark[]> {
    logger.info({ userId, limit }, 'Getting recent bookmarks');

    const pool = await this.getPool();
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT id, url, title, description, tags, user_id as "userId", channel_id as "channelId",
               created_at as "createdAt", updated_at as "updatedAt"
        FROM bookmarks 
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;

      const result = await client.query(query, [userId, limit]);
      
      const bookmarks = result.rows.map(row => ({
        ...row,
        tags: row.tags
      }));

      logger.info({ bookmarksFound: bookmarks.length }, 'Recent bookmarks retrieved');
      return bookmarks;

    } catch (error) {
      logger.error({ error, userId }, 'Failed to get recent bookmarks');
      throw new DatabaseError(`Failed to get recent bookmarks: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  async getSeedTags(userId: string, teamId?: string, limit = 20): Promise<string[]> {
    logger.info({ userId, teamId, limit }, 'Getting seed tags');

    // If teamId provided, get team tags; otherwise fallback to user tags
    if (teamId) {
      return this.getExistingTags(teamId).then(tags => tags.slice(0, limit));
    }

    const pool = await this.getPool();
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT jsonb_array_elements_text(tags) as tag, COUNT(*) as frequency
        FROM bookmarks 
        WHERE user_id = $1
        GROUP BY tag
        ORDER BY frequency DESC, tag
        LIMIT $2
      `;

      const result = await client.query(query, [userId, limit]);
      const tags = result.rows.map(row => row.tag);

      logger.info({ tagsFound: tags.length }, 'Seed tags retrieved');
      return tags;

    } catch (error) {
      logger.error({ error, userId }, 'Failed to get seed tags');
      throw new DatabaseError(`Failed to get seed tags: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  async getExistingTags(teamId: string): Promise<string[]> {
    logger.info({ teamId }, 'Getting existing team tags');

    const pool = await this.getPool();
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT tag_name, usage_count
        FROM team_tags 
        WHERE team_id = $1
        ORDER BY usage_count DESC, tag_name ASC
      `, [teamId]);

      const databaseTags = result.rows.map(row => row.tag_name);
      
      // Always include seed tags - common tags that are useful for any team
      const seedTags = [
        'javascript', 'typescript', 'python', 'java', 'go', 'rust',
        'react', 'vue', 'angular', 'nodejs', 'express',
        'programming', 'coding', 'development', 'software', 'web development',
        'frontend', 'backend', 'fullstack', 'api', 'database',
        'tutorial', 'documentation', 'guide', 'reference',
        'github', 'open source', 'repository', 'code',
        'framework', 'library', 'tool', 'utility',
        'ai', 'machine learning', 'ml', 'llm', 'openai',
        'design', 'ui', 'ux', 'css', 'html',
        'devops', 'docker', 'kubernetes', 'aws', 'cloud', 'container'
      ];
      
      // Efficient deduplication using Set - O(n) instead of O(n²)
      const tagSet = new Set([...databaseTags, ...seedTags]);
      const allTags = Array.from(tagSet);

      logger.info({ teamTagsFound: databaseTags.length, totalTags: allTags.length }, 'Existing tags retrieved');
      return allTags;

    } catch (error) {
      logger.error({ error, teamId }, 'Failed to get existing tags');
      throw new DatabaseError(`Failed to get existing tags: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  async getPopularTags(teamId: string, limit = 20): Promise<{tagName: string, usageCount: number}[]> {
    logger.info({ teamId, limit }, 'Getting popular tags');

    const pool = await this.getPool();
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT tag_name as "tagName", usage_count as "usageCount"
        FROM team_tags 
        WHERE team_id = $1
        ORDER BY usage_count DESC, tag_name ASC
        LIMIT $2
      `, [teamId, limit]);

      logger.info({ popularTagsFound: result.rows.length }, 'Popular tags retrieved');
      return result.rows;

    } catch (error) {
      logger.error({ error, teamId }, 'Failed to get popular tags');
      throw new DatabaseError(`Failed to get popular tags: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  // Cleanup method for Lambda context reuse
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}