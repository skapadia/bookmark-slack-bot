#!/usr/bin/env node

/**
 * Database initialization script
 * This script invokes the private Lambda to initialize the database schema
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const LAMBDA_FUNCTION_NAME = process.env.LAMBDA_PRIVATE_NAME || 'bookmark-bot-private-development';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

async function initializeDatabase() {
  console.log('🗄️  Initializing database schema...');
  
  const client = new LambdaClient({ region: AWS_REGION });
  
  const request = {
    operation: 'initializeSchema',
    payload: {}
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

    console.log('✅ Database schema initialized successfully!');
    console.log(`📅 Completed at: ${result.timestamp}`);
    
    if (result.data && result.data.message) {
      console.log(`📋 Message: ${result.data.message}`);
    }

  } catch (error) {
    console.error('❌ Failed to initialize database schema:');
    console.error(error.message);
    process.exit(1);
  }
}

// Check for required environment variables
if (!process.env.LAMBDA_PRIVATE_NAME && !process.env.AWS_REGION) {
  console.log('💡 Usage:');
  console.log('   LAMBDA_PRIVATE_NAME=your-function-name AWS_REGION=us-east-1 node scripts/init-database.js');
  console.log('');
  console.log('   Or use defaults:');
  console.log('   - LAMBDA_PRIVATE_NAME: bookmark-bot-private-development');  
  console.log('   - AWS_REGION: us-east-1');
  console.log('');
}

initializeDatabase();