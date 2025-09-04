import { App, AwsLambdaReceiver } from '@slack/bolt';
import type { Handler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { BookmarkCreateRequest } from '@bookmark-slack-bot/shared/types';
import { BookmarkService } from '@bookmark-slack-bot/core/services';
import { SophisticatedBedrockTagGenerator } from '../implementations/sophisticated-bedrock-tag-generator.js';
import { WebMetadataExtractor } from '../implementations/web-metadata-extractor.js';
import { LambdaBookmarkRepository } from '../implementations/lambda-bookmark-repository.js';
import { validateUrl, createServiceLogger, slackConfig } from '@bookmark-slack-bot/shared';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const logger = createServiceLogger('slack-handler');

// Async bookmark event interface
interface AsyncBookmarkEvent {
  type: 'process_bookmark';
  command: {
    text: string;
    user_id: string;
    team_id: string;
    channel_id: string;
    response_url: string;
  };
}

// Initialize Lambda client
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Store Lambda context globally for access in command handlers
let currentLambdaContext: any = null;

// Initialize implementations
const bookmarkRepository = new LambdaBookmarkRepository();
const tagGenerator = new SophisticatedBedrockTagGenerator(bookmarkRepository);
const metadataExtractor = new WebMetadataExtractor();

// Initialize service
const bookmarkService = new BookmarkService(
  bookmarkRepository,
  metadataExtractor,
  tagGenerator
);

// Initialize Slack app with Lambda receiver
const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: slackConfig.signingSecret,
});

const app = new App({
  token: slackConfig.botToken,
  receiver: awsLambdaReceiver,
  processBeforeResponse: true,
});

// Handle /bookmark command for adding new bookmarks
app.command('/bookmark', async ({ command, ack, respond }) => {
  await ack('🔄 Processing your bookmark...');

  logger.info({ command }, 'Bookmark command received');

  const text = command.text?.trim();
  if (!text) {
    await respond({
      text: '⚠️ Please provide a URL to bookmark.\nUsage: `/bookmark <URL> [tag1] [tag2] ...`',
      response_type: 'ephemeral'
    });
    return;
  }

  // Parse URL to validate quickly before async processing
  const parts = text.split(/\s+/);
  const url = parts[0];

  if (!validateUrl(url)) {
    await respond({
      text: '⚠️ Please provide a valid URL (must start with http:// or https://).',
      response_type: 'ephemeral'
    });
    return;
  }

  // Invoke this same Lambda function asynchronously to process the bookmark
  try {
    const asyncEvent: AsyncBookmarkEvent = {
      type: 'process_bookmark',
      command: {
        text: command.text,
        user_id: command.user_id,
        team_id: command.team_id,
        channel_id: command.channel_id,
        response_url: command.response_url
      }
    };

    await lambdaClient.send(new InvokeCommand({
      FunctionName: currentLambdaContext?.functionName,
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify(asyncEvent)
    }));

    logger.info({ url }, 'Async bookmark processing initiated');
  } catch (error) {
    logger.error({ 
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      functionName: currentLambdaContext?.functionName,
      url 
    }, 'Failed to initiate async processing');
    await respond({
      text: '⚠️ Sorry, there was an error processing your bookmark. Please try again.',
      response_type: 'ephemeral'
    });
  }
});

// Handle /bookmarks command for searching bookmarks
app.command('/bookmarks', async ({ command, ack, respond }) => {
  await ack();
  
  logger.info({ command }, 'Bookmarks search command received');

  try {
    const queryText = command.text?.trim();
    const searchFilters = {
      userId: command.user_id,
      ...(queryText && { query: queryText }),
      limit: 10
    };

    const results = await bookmarkService.searchBookmarks(searchFilters);

    if (results.bookmarks.length === 0) {
      const searchText = command.text?.trim();
      const message = searchText 
        ? `🔍 No bookmarks found matching "${searchText}".`
        : '🔍 You haven\'t saved any bookmarks yet.';
      
      await respond({
        text: message,
        response_type: 'ephemeral'
      });
      return;
    }

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔍 Found ${results.bookmarks.length} bookmark${results.bookmarks.length === 1 ? '' : 's'}${command.text ? ` for "${command.text}"` : ''}:`
        }
      },
      {
        type: 'divider'
      }
    ];

    // Add bookmark blocks (limit to avoid message size issues)
    const bookmarksToShow = results.bookmarks.slice(0, 5);
    for (const bookmark of bookmarksToShow) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*<${bookmark.url}|${bookmark.title}>*\n${bookmark.description || 'No description'}\n_Tags: ${bookmark.tags.length > 0 ? bookmark.tags.map((t: string) => `\`${t}\``).join(', ') : 'None'}_`
        }
      });
    }

    // Add "more results" note if needed
    if (results.bookmarks.length > 5) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_Showing first 5 of ${results.bookmarks.length} results. Use more specific search terms to narrow down._`
          }
        ]
      } as any);
    }

    await respond({
      blocks,
      response_type: 'ephemeral'
    });

    logger.info({ resultsCount: results.bookmarks.length }, 'Search results sent');

  } catch (error) {
    logger.error({ error, command }, 'Failed to search bookmarks');
    
    await respond({
      text: '⚠️ Sorry, there was an error searching your bookmarks. Please try again later.',
      response_type: 'ephemeral'
    });
  }
});

// Handle /bookmark-help command for instructions
app.command('/bookmark-help', async ({ command, ack, respond }) => {
  await ack();
  
  logger.info({ command }, 'Bookmark help command received');

  await respond({
    text: '📖 *Bookmark Bot Help*',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '📖 *Bookmark Bot Help*\n\nI help you save and organize web bookmarks with AI-powered tagging!'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Commands:*\n\n' +
                '• `/bookmark <URL>` - Save a bookmark\n' +
                '• `/bookmark <URL> tag1 tag2` - Save with manual tags\n' +
                '• `/bookmarks` - Show your recent bookmarks\n' +
                '• `/bookmarks search term` - Search your bookmarks\n' +
                '• `/bookmark-help` - Show this help message'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Features:*\n\n' +
                '• Automatic title and description extraction\n' +
                '• AI-powered tag generation based on content\n' +
                '• Add your own custom tags\n' +
                '• Search by title, description, tags, or URL\n' +
                '• Personal bookmarks (only you can see yours)'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Examples:*\n\n' +
                '`/bookmark https://docs.aws.amazon.com/lambda/`\n' +
                '`/bookmark https://react.dev/ react javascript frontend`\n' +
                '`/bookmarks react`\n' +
                '`/bookmarks AWS Lambda`'
        }
      }
    ],
    response_type: 'ephemeral'
  });
});

// Handle app mentions for help (fallback)
app.event('app_mention', async ({ event, client }) => {
  logger.info({ event }, 'App mention received');

  try {
    await client.chat.postMessage({
      channel: event.channel,
      text: `👋 Hi <@${event.user}>! Use \`/bookmark-help\` to see how to use me, or try \`/bookmark <URL>\` to save a bookmark!`
    });
  } catch (error) {
    logger.error({ error, event }, 'Failed to respond to app mention');
  }
});

// Error handling
app.error(async (error) => {
  logger.error({ error }, 'Slack app error occurred');
});

// Process bookmark asynchronously
async function processBookmarkAsync(event: AsyncBookmarkEvent): Promise<void> {
  const { command } = event;

  logger.info({ command }, 'Processing bookmark asynchronously');

  try {
    const parts = command.text.split(/\s+/);
    const url = parts[0];
    const manualTags = parts.slice(1).filter(tag => tag.length > 0);

    const request: BookmarkCreateRequest = {
      url,
      userId: command.user_id,
      teamId: command.team_id,
      channelId: command.channel_id,
      manualTags
    };

    const bookmark = await bookmarkService.createBookmark(request);

    // Send success response back to Slack using response_url
    const response = await fetch(command.response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `📖 Bookmark saved successfully!`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📖 *Bookmark saved!*\n\n*<${bookmark.url}|${bookmark.title}>*\n${bookmark.description || 'No description available'}`
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Tags: ${bookmark.tags.length > 0 ? bookmark.tags.map((t: string) => `\`${t}\``).join(', ') : 'None'}`
              }
            ]
          }
        ],
        response_type: 'ephemeral'
      })
    });

    if (!response.ok) {
      throw new Error(`Slack response error: ${response.status}`);
    }

    logger.info({ bookmarkId: bookmark.id, url: bookmark.url }, 'Async bookmark processing completed');

  } catch (error) {
    logger.error({ error, command }, 'Async bookmark processing failed');

    // Send error response to Slack
    await fetch(command.response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '⚠️ Sorry, there was an error saving your bookmark. Please try again later.',
        response_type: 'ephemeral'
      })
    });
  }
}

// Export the Lambda handler
export const handler: Handler<APIGatewayProxyEvent | AsyncBookmarkEvent, APIGatewayProxyResult> = async (event, context) => {
  // Store Lambda context globally for access in command handlers
  currentLambdaContext = context;
  
  // Check if this is an async bookmark processing event
  if ('type' in event && event.type === 'process_bookmark') {
    await processBookmarkAsync(event as AsyncBookmarkEvent);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Async processing completed' })
    };
  }

  // Handle normal Slack webhook events
  const handler = await awsLambdaReceiver.start();
  return handler(event as APIGatewayProxyEvent, context, () => {});
};