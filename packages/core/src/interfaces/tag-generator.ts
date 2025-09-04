export interface TagGenerator {
  generateTags(content: string, existingTags?: string[], options?: {
    url?: string;
    title?: string;
    description?: string;
    teamId?: string;
    manualTags?: string[];
  }): Promise<string[]>;
}

export interface TagGenerationRequest {
  content: string;
  existingTags?: string[];
  maxTags?: number;
}