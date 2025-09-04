import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { TagGenerator, BookmarkRepository } from '@bookmark-slack-bot/core/interfaces';
import { BedrockError, logger } from '@bookmark-slack-bot/shared';
import { bedrockConfig } from '@bookmark-slack-bot/shared/config';
// @ts-expect-error - fuzzball doesn't have types but works fine
import * as fuzz from 'fuzzball';
// @ts-expect-error - wink-lemmatizer doesn't have types but works fine
import * as lemmatizer from 'wink-lemmatizer';

export class SophisticatedBedrockTagGenerator implements TagGenerator {
  private client: BedrockRuntimeClient;
  private bookmarkRepository: BookmarkRepository;

  constructor(bookmarkRepository: BookmarkRepository) {
    this.client = new BedrockRuntimeClient({ 
      region: bedrockConfig.region,
      ...(bedrockConfig.profile && { profile: bedrockConfig.profile })
    });
    this.bookmarkRepository = bookmarkRepository;
  }

  async generateTags(content: string, existingTags?: string[], options?: {
    url?: string;
    title?: string; 
    description?: string;
    teamId?: string;
    manualTags?: string[];
  }): Promise<string[]> {
    logger.info({ 
      contentLength: content.length, 
      existingTagsCount: existingTags?.length,
      teamId: options?.teamId,
      hasManualTags: options?.manualTags && options.manualTags.length > 0
    }, 'Generating sophisticated tags with Bedrock');

    // If manual tags provided, use them as priority and optionally generate additional ones
    if (options?.manualTags && options.manualTags.length > 0) {
      const generatedTags = await this.generateTagsInternal(content, existingTags, options);
      const combinedTags = [...options.manualTags, ...generatedTags].slice(0, 8); // Limit to 8 tags max
      logger.info({ manualTagsCount: options.manualTags.length, generatedTagsCount: generatedTags.length, totalTags: combinedTags.length }, 'Combined manual and generated tags');
      return combinedTags;
    }

    // Generate tags normally
    return this.generateTagsInternal(content, existingTags, options);
  }

  private async generateTagsInternal(content: string, _existingTags?: string[], options?: {
    url?: string;
    title?: string;
    description?: string; 
    teamId?: string;
  }): Promise<string[]> {
    // Find existing tags that match content with scores
    const existingMatchesWithScores = await this.findTagsByKeywordsWithScores(
      options?.title || '', 
      options?.description || '', 
      options?.teamId
    );
    const existingMatches = existingMatchesWithScores.map(([tag]) => tag);
    
    logger.info({ 
      existingMatches, 
      existingMatchesWithScores: existingMatchesWithScores.slice(0, 3) // Log first 3 for debugging
    }, 'Found existing tag matches');

    // Generate tags with LLM
    const initialTags = await this.generateWithLLM(content, options, existingMatches);
    
    // Second LLM call to filter out low-specificity tags (but protect existing matches)
    logger.info({ initialTags }, 'Initial tags before specificity filter');
    const filteredTags = await this.filterTagsBySpecificity(initialTags, options, existingMatches);
    logger.info({ filteredTags }, 'Tags after specificity filter');
    
    // Hybrid approach: Force include high-scoring existing matches that LLM missed
    const hybridTags = this.addHighScoringExistingTags(filteredTags, existingMatchesWithScores);
    logger.info({ hybridTags }, 'Final tags after hybrid inclusion');
    
    return hybridTags;
  }

  private async generateWithLLM(content: string, options?: {
    url?: string;
    title?: string;
    description?: string;
  }, existingMatches: string[] = []): Promise<string[]> {
    let systemPrompt: string;
    
    if (existingMatches.length > 0) {
      systemPrompt = `Generate 3-5 specific, searchable tags for this bookmark.

URL: ${options?.url || 'Unknown'}
Title: ${options?.title || 'Unknown'}
Description: ${options?.description || 'No description available'}

PREFER these existing tags if appropriate: ${existingMatches.join(', ')}

AVOID generic quality terms like: "clean output", "good article", "useful tool", "helpful resource", "great example", "awesome project", "best practices", "high quality"

PREFER specific terms like:
- Technology names (typescript, react, python, docker)
- Domain concepts (api, database, tutorial, documentation)
- Platform names (github, stackoverflow, npm)
- Concrete topics that help search (not subjective quality)

Requirements:
- Use lowercase, single words or short phrases (2-3 words max)
- Prioritize existing tags when they fit the content
- Each tag should help someone find this specific type of content
- Focus on WHAT the content is about, not HOW GOOD it is
- Return as JSON array of strings only`;
    } else {
      systemPrompt = `Generate 3-5 specific, searchable tags for this bookmark:

URL: ${options?.url || 'Unknown'}
Title: ${options?.title || 'Unknown'}
Description: ${options?.description || 'No description available'}

AVOID generic quality terms like: "clean output", "good article", "useful tool", "helpful resource", "great example", "awesome project", "best practices", "high quality"

PREFER specific terms like:
- Technology names (typescript, react, python, docker)
- Domain concepts (api, database, tutorial, documentation)
- Platform names (github, stackoverflow, npm)
- Concrete topics that help search (not subjective quality)

Requirements:
- Use lowercase, single words or short phrases (2-3 words max)
- Each tag should help someone find this specific type of content
- Focus on WHAT the content is about, not HOW GOOD it is
- Be specific and useful for search/organization
- Return as JSON array of strings only`;
    }

    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 200, // Reasonable token limit for tag generation
      temperature: 0.1, // Lower temperature for more consistent tag generation
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: content
        }
      ]
    };

    try {
      const command = new InvokeModelCommand({
        modelId: bedrockConfig.modelId,
        contentType: 'application/json',
        body: JSON.stringify(payload)
      });

      const response = await this.client.send(command);
      
      if (!response.body) {
        throw new BedrockError('Empty response body from Bedrock');
      }

      const responseBody = JSON.parse(Buffer.from(response.body).toString());
      const generatedText = responseBody.content[0]?.text;

      if (!generatedText) {
        throw new BedrockError('No text content in Bedrock response');
      }

      // Parse JSON array from the response
      const jsonMatch = generatedText.match(/\[.*\]/s);
      if (!jsonMatch) {
        logger.warn({ generatedText }, 'Could not parse JSON from Bedrock response');
        return [];
      }

      const tags = JSON.parse(jsonMatch[0]) as string[];
      
      // Validate and clean tags
      const cleanTags = tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map(tag => tag.toLowerCase().trim())
        .filter(tag => tag.length > 0 && tag.length <= 50)
        .slice(0, 10); // Limit to 10 tags max

      return cleanTags;

    } catch (error) {
      if (error instanceof BedrockError) {
        throw error;
      }
      
      logger.error({ error }, 'Failed to generate tags with Bedrock');
      throw new BedrockError(`Failed to generate tags: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async filterTagsBySpecificity(tags: string[], options?: {
    url?: string;
    title?: string;
    description?: string;
  }, existingMatches: string[] = []): Promise<string[]> {
    if (tags.length === 0) return tags;
    
    // Separate existing tags (protected) from new generated tags (can be filtered)
    const protectedTags = tags.filter(tag => existingMatches.includes(tag));
    const candidateTags = tags.filter(tag => !existingMatches.includes(tag));
    
    logger.info({ protectedTags, candidateTags }, 'Separating tags for specificity filtering');
    
    // If no new tags to filter, return original tags
    if (candidateTags.length === 0) {
      return tags;
    }

    const systemPrompt = `Evaluate these bookmark tags for search specificity and usefulness. Remove any tags that are too generic, vague, or unhelpful for finding this specific content.

URL: ${options?.url || 'Unknown'}
Title: ${options?.title || 'Unknown'}
Description: ${options?.description || 'No description available'}

Tags to evaluate: ${candidateTags.join(', ')}

REMOVE tags that are:
- Too generic (e.g., "superset" when it just means "extension of")
- Subjective quality terms (e.g., "clean", "good", "awesome")
- Overly broad concepts that don't help narrow search
- Conceptual relationships that aren't searchable terms

KEEP tags that are:
- Specific technology names (typescript, react, python)
- Concrete platforms or tools (github, npm, docker)
- Specific domain concepts (api, database, tutorial)
- Terms someone would actually search for to find this content

Return only the useful tags as a JSON array. If a tag is borderline, err on the side of keeping it.`;

    try {
      const payload = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 100, // Sufficient tokens for filtering response
        temperature: 0.1, // Lower temperature for more consistent filtering
        system: systemPrompt,
        messages: [
          {
            role: "user", 
            content: `Filter these tags: ${candidateTags.join(', ')}`
          }
        ]
      };

      const command = new InvokeModelCommand({
        modelId: bedrockConfig.modelId,
        contentType: 'application/json',
        body: JSON.stringify(payload)
      });

      const response = await this.client.send(command);
      
      if (!response.body) {
        logger.warn('Empty response body from Bedrock specificity filter');
        return tags; // Return original tags if filtering fails
      }

      const responseBody = JSON.parse(Buffer.from(response.body).toString());
      const generatedText = responseBody.content[0]?.text;

      if (!generatedText) {
        logger.warn('No text content in Bedrock specificity filter response');
        return tags; // Return original tags if filtering fails
      }

      const jsonMatch = generatedText.match(/\[.*\]/s);
      if (!jsonMatch) {
        logger.warn({ generatedText }, 'Could not parse JSON from specificity filter response');
        return tags; // Return original tags if filtering fails
      }

      const filteredCandidateTags = JSON.parse(jsonMatch[0]) as string[];
      
      // Combine protected existing tags with filtered new tags
      const finalTags = [...protectedTags, ...filteredCandidateTags.filter(tag => typeof tag === 'string')];
      
      logger.info({ filteredCandidateTags, finalTags }, 'Completed specificity filtering');
      
      // Fallback: if LLM filtered out all candidate tags, keep at least the protected ones
      if (finalTags.length === 0) {
        logger.warn('Specificity filter removed everything, keeping originals');
        return tags;
      }
      
      return finalTags;
      
    } catch (error) {
      logger.warn({ error }, 'Specificity filter failed, keeping original tags');
      return tags; // Return original tags if filtering fails
    }
  }

  private addHighScoringExistingTags(currentTags: string[], existingMatchesWithScores: [string, number][]): string[] {
    const HIGH_SCORE_THRESHOLD = 15; // Tags with score >= 15 are very relevant
    const MAX_TOTAL_TAGS = 6; // Don't exceed reasonable tag limit
    
    // Find high-scoring existing tags that aren't already in current tags
    const highScoringMissingWithScores = existingMatchesWithScores
      .filter(([_tag, score]) => score >= HIGH_SCORE_THRESHOLD)
      .filter(([tag]) => !currentTags.includes(tag))
      .sort(([, scoreA], [, scoreB]) => scoreB - scoreA); // Sort by score (higher first)
    
    const highScoringMissing = highScoringMissingWithScores.map(([tag]) => tag);
    
    logger.info({ 
      highScoringMissingWithScores: highScoringMissingWithScores.slice(0, 3), // Log first 3
      highScoringMissing 
    }, 'Adding high-scoring missing existing tags');
    
    // Add high-scoring tags up to the limit
    const additionalTags = highScoringMissing.slice(0, MAX_TOTAL_TAGS - currentTags.length);
    const finalTags = [...currentTags, ...additionalTags];
    
    return finalTags;
  }

  /**
   * Check if two words are grammatical variations of each other using NLP lemmatization
   * Uses the 'wink-lemmatizer' library for accurate lemmatization of nouns, verbs, and adjectives
   */
  private isGrammaticalVariation(word1: string, word2: string): boolean {
    if (word1 === word2) return true;
    
    const w1 = word1.toLowerCase();
    const w2 = word2.toLowerCase();
    
    // Get lemmas for all parts of speech for both words
    const lemmas1 = [
      lemmatizer.noun(w1),
      lemmatizer.verb(w1),
      lemmatizer.adjective(w1)
    ];
    
    const lemmas2 = [
      lemmatizer.noun(w2),
      lemmatizer.verb(w2),
      lemmatizer.adjective(w2)
    ];
    
    // Check if any lemma matches between the two words
    return lemmas1.some(lemma1 => lemmas2.includes(lemma1));
  }

  private async findTagsByKeywordsWithScores(title: string, description: string, teamId?: string): Promise<[string, number][]> {
    // Extract keywords from title and description only (not URL)
    const content = `${title} ${description}`;
    const keywords = this.extractKeywords(content);
    
    logger.info({ 
      title, 
      description, 
      content, 
      keywords: keywords 
    }, 'Keywords extracted for tag matching'); // Log title, description, content, and keywords
    
    // Get existing tags from database or fallback to empty array
    let existingTags: string[] = [];
    if (teamId) {
      try {
        existingTags = await this.bookmarkRepository.getExistingTags(teamId);
      } catch (error) {
        logger.warn({ error }, 'Failed to fetch existing tags from database');
        existingTags = []; // Fallback to empty array
      }
    }
    
    // Find existing tags with scoring
    const tagScores = new Map<string, number>();
    
    for (const keyword of keywords) {
      // Context-aware word matches with different scoring based on match quality
      for (const tag of existingTags) {
        const oldScore = tagScores.get(tag) || 0;
        let scoreBoost = 0;
        let matchType = '';
        
        if (keyword === tag) {
          // Perfect match gets highest boost
          scoreBoost = 15;
          matchType = 'perfect';
        } else if (this.isGrammaticalVariation(keyword, tag)) {
          // Grammatical variations (singular/plural, verb forms) get high boost
          scoreBoost = 12;
          matchType = 'grammatical-variation';
        } else if (keyword.length > 2 && tag.includes(keyword)) {
          // Keyword is substring of tag - moderate boost
          scoreBoost = 8;
          matchType = 'keyword-in-tag';
        } else if (tag.length > 2 && keyword.includes(tag)) {
          // Tag is substring of keyword - lower boost (but still useful)
          scoreBoost = 5;
          matchType = 'tag-in-keyword';
        }
        
        if (scoreBoost > 0) {
          const newScore = oldScore + scoreBoost;
          tagScores.set(tag, newScore);
          logger.debug({ matchType, keyword, tag, oldScore, newScore }, 'Tag match found');
        }
      }
      
      // Fuzzy matches (lower priority, higher threshold)
      for (const tag of existingTags) {
        if (!tagScores.has(tag)) { // Don't override exact matches
          const similarity = fuzz.ratio(keyword, tag);
          if (similarity >= 80) { // Higher threshold to reduce noise
            const score = similarity / 10;
            tagScores.set(tag, score);
            logger.debug({ keyword, tag, similarity, score }, 'Fuzzy tag match found');
          }
        }
      }
    }
    
    // Sort by score and return top matches with scores
    const sortedTagsWithScores = Array.from(tagScores.entries())
      .sort(([, a], [, b]) => b - a)  // Sort by score descending
      .slice(0, 6);  // Limit to 6 best matches
    
    return sortedTagsWithScores;
  }
  
  private extractKeywords(text: string): string[] {
    const stopWords = ['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'boy', 'did', 'does', 'let', 'put', 'say', 'she', 'too', 'use'];
    
    return text.toLowerCase()
      .split(/[\s/-_.,!?():]+/)
      .filter(word => word.length > 2)
      .filter(word => !stopWords.includes(word))
      .filter(word => !word.match(/^\d+$/)); // Remove numbers
  }
}