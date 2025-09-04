import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { logger } from '@bookmark-slack-bot/shared';

interface DatabaseCredentials {
  username: string;
  password: string;
  host: string;
  port: number;
  dbname: string;
}

let cachedCredentials: DatabaseCredentials | null = null;
let secretsClient: SecretsManagerClient | null = null;

function getSecretsClient(): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
  }
  return secretsClient;
}

export async function getDatabaseCredentials(): Promise<DatabaseCredentials> {
  // Return cached credentials if available (for Lambda container reuse)
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const secretArn = process.env.DATABASE_SECRET_ARN;
  if (!secretArn) {
    throw new Error('DATABASE_SECRET_ARN environment variable is required');
  }

  logger.info({ secretArn }, 'Retrieving database credentials from Secrets Manager');

  try {
    const client = getSecretsClient();
    const command = new GetSecretValueCommand({
      SecretId: secretArn
    });

    const response = await client.send(command);
    
    if (!response.SecretString) {
      throw new Error('Secret value is empty');
    }

    const credentials = JSON.parse(response.SecretString) as DatabaseCredentials;
    
    // Validate required fields
    if (!credentials.username || !credentials.password || !credentials.host || !credentials.dbname) {
      throw new Error('Invalid database credentials format in secret');
    }

    // Cache credentials for subsequent Lambda invocations
    cachedCredentials = credentials;
    
    logger.info({ host: credentials.host, dbname: credentials.dbname }, 'Database credentials retrieved successfully');
    return credentials;

  } catch (error) {
    logger.error({ error, secretArn }, 'Failed to retrieve database credentials');
    throw new Error(`Failed to get database credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}