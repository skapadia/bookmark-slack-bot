import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { TagGenerator } from '@bookmark-slack-bot/core/interfaces';
import { BedrockError, logger } from '@bookmark-slack-bot/shared';
import { bedrockConfig } from '@bookmark-slack-bot/shared/config';

export class BedrockTagGenerator implements TagGenerator {
  private client: BedrockRuntimeClient;

  constructor() {
    this.client = new BedrockRuntimeClient({ 
      region: bedrockConfig.region,
      ...(bedrockConfig.profile && { profile: bedrockConfig.profile })
    });
  }

  async generateTags(content: string, existingTags?: string[], _options?: {
    url?: string;
    title?: string;
    description?: string;
    teamId?: string;
    manualTags?: string[];
  }): Promise<string[]> {
    logger.info({ contentLength: content.length, existingTagsCount: existingTags?.length }, 'Generating tags with Bedrock');

    const systemPrompt = `You are a helpful assistant that generates relevant, specific tags for bookmarked content. 
    
Guidelines:
- Generate 3-7 concise, relevant tags
- Focus on specific technologies, concepts, and topics mentioned
- Use lowercase, hyphenated format (e.g., "machine-learning", "aws-lambda")
- Avoid generic tags like "article", "blog", "tutorial" unless specifically relevant
- Consider existing user tags for consistency: ${existingTags?.join(', ') || 'none'}
- Return only the tags as a JSON array of strings`;

    const userPrompt = `Generate tags for this content:\n\n${content}`;

    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 200, // Reasonable token limit for tag generation
      temperature: 0.1, // Lower temperature for more consistent results
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt
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

      logger.info({ tagsGenerated: cleanTags.length }, 'Tags generated successfully');
      return cleanTags;

    } catch (error) {
      if (error instanceof BedrockError) {
        throw error;
      }
      
      logger.error({ error }, 'Failed to generate tags with Bedrock');
      throw new BedrockError(`Failed to generate tags: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}