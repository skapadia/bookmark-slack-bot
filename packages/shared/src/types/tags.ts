export interface TagGenerationOptions {
  maxTags: number;
  useAI: boolean;
  existingTags?: string[];
  scoreThreshold?: number;
}

export interface TagMatch {
  tag: string;
  score: number;
  matchType: 'perfect' | 'keyword-in-tag' | 'tag-in-keyword' | 'fuzzy';
}

export interface TagGenerationResult {
  tags: string[];
  matches: TagMatch[];
  fallbackUsed: boolean;
  method: 'ai' | 'keyword' | 'manual';
}