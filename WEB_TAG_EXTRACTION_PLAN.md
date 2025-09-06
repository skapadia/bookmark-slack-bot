# Web Tag Extraction Plan

This document outlines a potential enhancement to extract tags directly from web pages and integrate them with the existing AI-powered tag generation system.

## Background

Currently, the bookmark bot generates tags using AI analysis of page content (title/description). This plan explores supplementing AI tags with tags that websites explicitly provide through standard meta tags and structured data.

## Standard Meta Tags and Formats

Yes, there are several standard meta tags and formats where web pages can store tags:

### Standard Meta Tags

1. **Keywords meta tag** (legacy but still used):
```html
<meta name="keywords" content="javascript, react, tutorial, frontend">
```

2. **Article tags** (for news/blog sites):
```html
<meta name="article:tag" content="javascript">
<meta name="article:tag" content="react">
<meta name="article:tag" content="tutorial">
```

### Structured Data (JSON-LD)

Many modern sites use structured data:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "keywords": ["javascript", "react", "tutorial"]
}
</script>
```

### Social Media Meta Tags

- **Twitter Cards**: `<meta name="twitter:label1" content="Tags">`
- **Open Graph**: Not standard for tags, but sometimes used

### Content Management Systems

- **WordPress**: Often adds tags in `<meta name="tags" content="...">`
- **Medium**: Uses structured data
- **Dev.to**: Uses meta keywords and structured data

## Reality Check

Most websites **don't** have explicit tag meta tags. The current AI-powered approach in the bookmark bot is actually better than trying to extract existing tags because:

1. **Inconsistent implementation** - No universal standard
2. **Poor quality** - Many sites have outdated/irrelevant keyword meta tags
3. **SEO spam** - Keywords meta tag is often stuffed with irrelevant terms
4. **Missing entirely** - Most modern sites don't bother with explicit tags

The current approach of generating tags from title/description content is more reliable and produces better, more relevant tags than trying to parse potentially non-existent or low-quality meta tags.

## Proposed Implementation

### 1. Update BookmarkMetadata Type

```typescript
// In packages/shared/src/types/metadata.ts
export interface BookmarkMetadata {
  title: string;
  description: string;
  url: string;
  extractedAt: Date;
  imageUrl?: string;
  tags?: string[]; // Add this optional property
}
```

### 2. Extend WebMetadataExtractor

Update the `parseHtmlMetadata` method to include tag extraction:

```typescript
private parseHtmlMetadata(html: string, url: string): BookmarkMetadata {
  // Existing title and description extraction...
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  let title = titleMatch?.[1]?.trim() || '';
  
  // Try Open Graph title if no title found
  if (!title) {
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']*)/i);
    title = ogTitleMatch?.[1]?.trim() || '';
  }

  // Extract description (existing code...)
  let description = '';
  const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)/i);
  description = metaDescMatch?.[1]?.trim() || '';

  // NEW: Extract tags from various sources
  const extractedTags = this.extractTagsFromHtml(html);

  // Clean up HTML entities
  title = this.decodeHtmlEntities(title);
  description = this.decodeHtmlEntities(description);

  if (!title) {
    title = this.createTitleFromUrl(url);
  }

  const metadata: BookmarkMetadata = {
    title: title.substring(0, 500),
    description: description.substring(0, 1000),
    url,
    extractedAt: new Date()
  };

  // Add extracted tags if any were found
  if (extractedTags.length > 0) {
    metadata.tags = extractedTags;
  }

  return metadata;
}
```

### 3. Tag Extraction Method

```typescript
private extractTagsFromHtml(html: string): string[] {
  const tags = new Set<string>();

  // 1. Keywords meta tag
  const keywordsMatch = html.match(/<meta\s+name=["']keywords["']\s+content=["']([^"']*)/i);
  if (keywordsMatch) {
    const keywords = keywordsMatch[1]
      .split(/[,;]/)
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag.length > 0 && tag.length <= 30);
    keywords.forEach(tag => tags.add(tag));
  }

  // 2. Article tags (news/blog sites)
  const articleTagMatches = html.matchAll(/<meta\s+name=["']article:tag["']\s+content=["']([^"']*)/gi);
  for (const match of articleTagMatches) {
    const tag = match[1].trim().toLowerCase();
    if (tag && tag.length <= 30) {
      tags.add(tag);
    }
  }

  // 3. WordPress/CMS tags
  const cmsTagsMatch = html.match(/<meta\s+name=["']tags["']\s+content=["']([^"']*)/i);
  if (cmsTagsMatch) {
    const cmsTags = cmsTagsMatch[1]
      .split(/[,;]/)
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag.length > 0 && tag.length <= 30);
    cmsTags.forEach(tag => tags.add(tag));
  }

  // 4. JSON-LD structured data
  const jsonLdMatches = html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([^<]*)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const jsonData = JSON.parse(match[1]);
      const keywords = this.extractKeywordsFromJsonLd(jsonData);
      keywords.forEach(tag => {
        if (tag.length <= 30) {
          tags.add(tag.toLowerCase());
        }
      });
    } catch (error) {
      // Ignore malformed JSON-LD
      logger.debug({ error }, 'Failed to parse JSON-LD for tags');
    }
  }

  // 5. Category/taxonomy links (common pattern)
  const categoryMatches = html.matchAll(/<a[^>]*(?:class=["'][^"']*(?:tag|category|label)[^"']*["']|href=["'][^"']*(?:tag|category)[^"']*["'])[^>]*>([^<]+)<\/a>/gi);
  for (const match of categoryMatches) {
    const tag = match[1].trim().toLowerCase();
    // Be more selective with link text to avoid noise
    if (tag && tag.length >= 2 && tag.length <= 20 && !tag.includes(' ')) {
      tags.add(tag);
    }
  }

  // Convert to array and limit quantity
  const tagArray = Array.from(tags).slice(0, 10); // Limit to 10 extracted tags

  logger.debug({ extractedTagCount: tagArray.length, tags: tagArray }, 'Extracted tags from HTML');
  
  return tagArray;
}
```

### 4. JSON-LD Keyword Extraction

```typescript
private extractKeywordsFromJsonLd(jsonData: any): string[] {
  const keywords: string[] = [];
  
  // Handle arrays of JSON-LD objects
  const items = Array.isArray(jsonData) ? jsonData : [jsonData];
  
  for (const item of items) {
    if (typeof item !== 'object' || !item) continue;
    
    // Extract keywords property
    if (item.keywords) {
      if (Array.isArray(item.keywords)) {
        keywords.push(...item.keywords.filter(k => typeof k === 'string'));
      } else if (typeof item.keywords === 'string') {
        // Keywords might be comma-separated
        keywords.push(...item.keywords.split(',').map(k => k.trim()));
      }
    }
    
    // Extract tags property (some sites use this)
    if (item.tags && Array.isArray(item.tags)) {
      keywords.push(...item.tags.filter(k => typeof k === 'string'));
    }
    
    // Extract about.name for topics (schema.org Thing)
    if (item.about && Array.isArray(item.about)) {
      for (const about of item.about) {
        if (about.name && typeof about.name === 'string') {
          keywords.push(about.name);
        }
      }
    }
  }
  
  return keywords.filter(k => k && k.length > 0);
}
```

## Integration with Tag Generator

### 1. Update SophisticatedBedrockTagGenerator

```typescript
// In SophisticatedBedrockTagGenerator.generateTagsInternal()
private async generateTagsInternal(content: string, _existingTags?: string[], options?: {
  url?: string;
  title?: string;
  description?: string; 
  teamId?: string;
  extractedTags?: string[]; // New parameter
}): Promise<string[]> {
  
  // Get existing database tags with scores (current logic)
  const existingMatchesWithScores = await this.findTagsByKeywordsWithScores(
    options?.title || '', 
    options?.description || '', 
    options?.teamId
  );

  // NEW: Score extracted tags from webpage metadata
  const scoredExtractedTags = this.scoreExtractedTags(
    options?.extractedTags || [],
    options?.title || '',
    options?.description || ''
  );

  // Combine all scored tag sources
  const allScoredTags = [
    ...existingMatchesWithScores,
    ...scoredExtractedTags
  ];

  // Continue with existing logic...
  const existingMatches = allScoredTags.map(([tag]) => tag);
  const initialTags = await this.generateWithLLM(content, options, existingMatches);
  
  // Rest of existing logic...
}
```

### 2. Usage in CompleteBookmarkService

```typescript
// In the CompleteBookmarkService
const generatedTags = await this.tagGenerator.generateTags(contentForTagGeneration, existingTags, {
  url: payload.url,
  title: payload.title,
  description: payload.description,
  teamId: payload.teamId,
  extractedTags: metadata.tags, // Pass extracted tags from web scraping
  ...(payload.manualTags && { manualTags: payload.manualTags })
});
```

## Scoring Algorithm for Extracted Tags

### Scoring Method

```typescript
private scoreExtractedTags(
  extractedTags: string[], 
  title: string, 
  description: string
): [string, number][] {
  const content = `${title} ${description}`.toLowerCase();
  const contentWords = new Set(content.split(/\s+/));
  
  return extractedTags.map(tag => {
    let score = 0;
    const normalizedTag = tag.toLowerCase().trim();
    
    // Base score for being an extracted tag
    score += 5; // Lower than perfect database matches (15) but higher than fuzzy (8)
    
    // Bonus for relevance to content
    if (content.includes(normalizedTag)) {
      score += 8; // Tag appears in title/description
    }
    
    // Bonus for individual words matching
    const tagWords = normalizedTag.split(/[\s-_]+/);
    const matchingWords = tagWords.filter(word => contentWords.has(word));
    score += matchingWords.length * 2; // 2 points per matching word
    
    // Penalty for very long tags (likely spammy)
    if (normalizedTag.length > 20) {
      score -= 3;
    }
    
    // Penalty for tags with numbers (often not semantic)
    if (/\d/.test(normalizedTag)) {
      score -= 2;
    }
    
    // Bonus for single-word tags (often more focused)
    if (!normalizedTag.includes(' ') && normalizedTag.length > 2) {
      score += 1;
    }
    
    // Quality filtering - reject very low scores
    return score >= 4 ? [tag, score] as [string, number] : null;
  }).filter((item): item is [string, number] => item !== null);
}
```

### Hybrid Integration Strategy

```typescript
private addHighScoringExtractedAndExistingTags(
  currentTags: string[], 
  existingMatchesWithScores: [string, number][],
  extractedTagsWithScores: [string, number][]
): string[] {
  const EXISTING_HIGH_SCORE_THRESHOLD = 15; // Database tags (highest priority)
  const EXTRACTED_HIGH_SCORE_THRESHOLD = 10; // Extracted tags (medium priority) 
  const MAX_TOTAL_TAGS = 6;
  
  // Prioritize high-scoring existing database tags first
  const highScoringExisting = existingMatchesWithScores
    .filter(([_tag, score]) => score >= EXISTING_HIGH_SCORE_THRESHOLD)
    .filter(([tag]) => !currentTags.includes(tag))
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA);
  
  // Then add high-scoring extracted tags
  const highScoringExtracted = extractedTagsWithScores
    .filter(([_tag, score]) => score >= EXTRACTED_HIGH_SCORE_THRESHOLD)
    .filter(([tag]) => !currentTags.includes(tag) && !highScoringExisting.some(([existingTag]) => existingTag === tag))
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA);
  
  // Combine in priority order
  const availableSlots = MAX_TOTAL_TAGS - currentTags.length;
  const tagsToAdd = [
    ...highScoringExisting.map(([tag]) => tag),
    ...highScoringExtracted.map(([tag]) => tag)
  ].slice(0, availableSlots);
  
  return [...currentTags, ...tagsToAdd];
}
```

## Scoring Scenarios

### Example 1: High-quality extracted tag
- **Title**: "React Hooks Tutorial" 
- **Extracted tag**: "react"
- **Score**: 5 (base) + 8 (appears in content) + 2 (word match) + 1 (single word) = **16**

### Example 2: Relevant but longer tag
- **Title**: "Machine Learning with Python"
- **Extracted tag**: "machine learning" 
- **Score**: 5 (base) + 8 (appears in content) + 4 (two word matches) = **17**

### Example 3: Spammy/irrelevant tag
- **Title**: "React Tutorial"
- **Extracted tag**: "web development 2024 best practices"
- **Score**: 5 (base) - 3 (too long) = **2** (rejected, below threshold)

### Example 4: Partially relevant tag
- **Title**: "JavaScript Tips"  
- **Extracted tag**: "programming"
- **Score**: 5 (base) + 0 (doesn't appear) + 0 (no word matches) + 1 (single word) = **6** (kept but low priority)

## Priority System

The scoring ensures extracted tags complement rather than overwhelm the AI-based tag generation system:

1. **Existing database tags**: Score 15+ (highest priority)
2. **High-quality extracted tags**: Score 10+ (medium priority)
3. **AI-generated tags**: Always included (current behavior)
4. **Low-scoring extracted tags**: Score 4-9 (lowest priority, space permitting)

## Benefits and Risks

### Benefits
- **Supplement AI tags**: Add author-intended tags that AI might miss
- **Domain expertise**: Sites often tag with domain-specific terms
- **Consistency**: Some sites have high-quality, consistent tagging
- **Speed**: No AI call needed for extracted tags

### Risks
- **Maintenance overhead**: More complex parsing logic
- **Quality variance**: Inconsistent tag quality across sites
- **Spam potential**: SEO-stuffed keywords could pollute results
- **Limited adoption**: Most sites don't have useful meta tags

## Implementation Phases

### Phase 1: Basic Implementation
- [ ] Update `BookmarkMetadata` type to include optional tags
- [ ] Implement basic keywords meta tag extraction
- [ ] Add scoring logic for extracted tags
- [ ] Integrate with existing tag generation pipeline

### Phase 2: Enhanced Extraction
- [ ] Add JSON-LD structured data parsing
- [ ] Implement article:tag meta tag support
- [ ] Add category/taxonomy link extraction
- [ ] Enhanced filtering and quality controls

### Phase 3: Optimization
- [ ] Performance testing with real websites
- [ ] Quality analysis of extracted vs AI-generated tags
- [ ] Fine-tune scoring thresholds based on results
- [ ] Add metrics/logging for extraction success rates

## Recommendation

While technically feasible, this enhancement should be considered **low priority** because:

1. The current AI-based approach already produces high-quality tags
2. Most websites lack useful meta tag information
3. Implementation complexity outweighs likely benefits
4. Resources better spent on other features (search, UI improvements, etc.)

If implemented, start with Phase 1 and evaluate real-world results before proceeding to more complex extraction methods.