#!/usr/bin/env node

/**
 * Get existing tags script
 * This script invokes the private Lambda to retrieve existing tags for a team
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const LAMBDA_FUNCTION_NAME = process.env.LAMBDA_PRIVATE_NAME || 'bookmark-bot-private-development';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const TEAM_ID = process.env.TEAM_ID;

async function getExistingTags() {
  if (!TEAM_ID) {
    console.error('❌ TEAM_ID environment variable is required');
    console.log('💡 Usage:');
    console.log('   TEAM_ID=your-team-id node scripts/get-tags.js');
    console.log('');
    console.log('   Optional environment variables:');
    console.log('   - LAMBDA_PRIVATE_NAME: bookmark-bot-private-development (default)');
    console.log('   - AWS_REGION: us-east-1 (default)');
    process.exit(1);
  }

  console.log('🏷️  Retrieving existing tags...');
  console.log(`👥 Team ID: ${TEAM_ID}`);
  
  const client = new LambdaClient({ region: AWS_REGION });
  
  const request = {
    operation: 'getExistingTags',
    payload: {
      teamId: TEAM_ID
    }
  };

  try {
    const command = new InvokeCommand({
      FunctionName: LAMBDA_FUNCTION_NAME,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(request)
    });

    console.log(`📡 Invoking Lambda: ${LAMBDA_FUNCTION_NAME}`);
    const response = await client.send(command);

    if (!response.Payload) {
      throw new Error('Empty response from Lambda');
    }

    const result = JSON.parse(Buffer.from(response.Payload).toString());
    
    if (!result.success) {
      throw new Error(`Lambda error: ${result.error}`);
    }

    const tags = result.data;
    
    if (!Array.isArray(tags)) {
      throw new Error('Invalid response format: expected array of tags');
    }

    console.log('✅ Tags retrieved successfully!');
    console.log(`📊 Total tags: ${tags.length}`);
    console.log(`📅 Retrieved at: ${result.timestamp}`);
    console.log('');
    
    if (tags.length === 0) {
      console.log('📝 No tags found for this team.');
    } else {
      console.log('🏷️  Existing tags:');
      console.log('==================');
      
      // Sort tags alphabetically for better readability
      const sortedTags = [...tags].sort();
      
      // Print tags in columns for better readability
      const maxWidth = Math.max(...sortedTags.map(tag => tag.length));
      const columns = Math.floor(80 / (maxWidth + 2)); // 2 for spacing
      
      for (let i = 0; i < sortedTags.length; i += columns) {
        const row = sortedTags.slice(i, i + columns);
        const paddedRow = row.map(tag => tag.padEnd(maxWidth + 1));
        console.log(paddedRow.join(' '));
      }
    }

  } catch (error) {
    console.error('❌ Failed to retrieve tags:');
    console.error(error.message);
    process.exit(1);
  }
}

getExistingTags();
