import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
// import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'; // Currently unused
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export interface BookmarkStackProps extends cdk.StackProps {
  environment: 'development' | 'staging' | 'production';
}

export class BookmarkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly database: rds.DatabaseInstance;
  public readonly publicLambda: NodejsFunction;
  public readonly privateLambda: NodejsFunction;
  public readonly api: apigateway.RestApi;
  public readonly privateLambdaSG: ec2.SecurityGroup;
  public readonly rdsSG: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: BookmarkStackProps) {
    super(scope, id, props);

    const { environment } = props;
    const bedrockModelId = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

    // Create VPC with cost-optimized dual Lambda architecture
    // No NAT Gateway = saves $50+ per month
    this.vpc = new ec2.Vpc(this, 'BookmarkVPC', {
      maxAzs: 2,
      natGateways: 0, // No NAT Gateway for cost savings
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'PublicSubnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'DatabaseSubnet',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED, // For RDS only
        },
      ],
    });

    // Security Groups
    this.privateLambdaSG = new ec2.SecurityGroup(this, 'PrivateLambdaSG', {
      vpc: this.vpc as ec2.IVpc,
      description: 'Private Lambda - database access only',
      allowAllOutbound: true, // Needed for VPC endpoints
    });

    this.rdsSG = new ec2.SecurityGroup(this, 'RdsSG', {
      vpc: this.vpc as ec2.IVpc,
      description: 'RDS PostgreSQL security group',
      allowAllOutbound: false,
    });

    // Allow private Lambda to connect to RDS
    this.rdsSG.addIngressRule(
      this.privateLambdaSG,
      ec2.Port.tcp(5432),
      'Private Lambda to RDS PostgreSQL'
    );

    // VPC Endpoints - NAT Gateway alternative
    // Only add endpoints for services the private Lambda needs
    this.vpc.addInterfaceEndpoint('SecretsManagerVpcEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [this.privateLambdaSG],
    });

    this.vpc.addInterfaceEndpoint('BedrockVpcEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [this.privateLambdaSG],
    });

    // RDS PostgreSQL Database
    this.database = new rds.DatabaseInstance(this, 'BookmarkDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc: this.vpc as ec2.IVpc,
      credentials: rds.Credentials.fromGeneratedSecret('bookmark_user', {
        secretName: `bookmark-db-credentials-${environment}`,
      }),
      databaseName: `bookmark_${environment}`,
      allocatedStorage: 20,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: environment === 'production',
      securityGroups: [this.rdsSG],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      removalPolicy: environment === 'production' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Create private Lambda function (database operations) - VPC attached
    this.privateLambda = new NodejsFunction(this, 'PrivateLambda', {
      functionName: `bookmark-bot-private-${environment}`,
      entry: '../lambda-private/src/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(45),
      memorySize: 1024,
      vpc: this.vpc as ec2.IVpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [this.privateLambdaSG],
      environment: {
        NODE_ENV: environment,
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        DATABASE_SECRET_ARN: this.database.secret!.secretArn,
        BEDROCK_MODEL_ID: bedrockModelId,
        // Add required env vars even though private Lambda doesn't use them
        // TODO: Refactor shared config to have separate schemas per Lambda
        LAMBDA_PRIVATE_NAME: `bookmark-bot-private-${environment}`,
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || 'unused',
        SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET || 'unused',
      },
      bundling: {
        minify: environment === 'production',
        sourceMap: environment !== 'production',
        target: 'es2022',
        format: 'esm' as any, // OutputFormat.ESM not available in this CDK version
        banner: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
        externalModules: ['pg-native'], // Exclude native modules
      },
      logRetention: environment === 'production' 
        ? logs.RetentionDays.ONE_MONTH 
        : logs.RetentionDays.ONE_WEEK,
    });

    // Grant private Lambda access to read the database secret (identity-based)
    this.privateLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:GetSecretValue'
      ],
      resources: [
        this.database.secret!.secretArn
      ]
    }));

    // Grant private Lambda access to Bedrock for AI tag generation
    this.privateLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/${bedrockModelId}`
      ]
    }));

    // Create public Lambda function (Slack integration) - NO VPC for internet access
    this.publicLambda = new NodejsFunction(this, 'PublicLambda', {
      functionName: `bookmark-bot-public-${environment}`,
      entry: '../lambda-public/src/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512, // More memory for AI operations
      // NO VPC configuration = internet access for Slack and Bedrock
      environment: {
        NODE_ENV: environment,
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        LAMBDA_PRIVATE_NAME: this.privateLambda.functionName,
        BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0',
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN!,
        SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET!,
      },
      bundling: {
        minify: environment === 'production',
        sourceMap: environment !== 'production',
        target: 'es2022',
        format: 'esm' as any, // OutputFormat.ESM not available in this CDK version
        banner: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
        externalModules: [],
      },
      logRetention: environment === 'production' 
        ? logs.RetentionDays.ONE_MONTH 
        : logs.RetentionDays.ONE_WEEK,
    });

    // Grant public Lambda permission to invoke private Lambda (identity-based)
    this.publicLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:InvokeFunction'
      ],
      resources: [
        this.privateLambda.functionArn
      ]
    }));

    // Grant public Lambda permission to invoke itself for async processing
    this.publicLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:InvokeFunction'
      ],
      resources: [
        `arn:aws:lambda:${this.region}:${this.account}:function:bookmark-bot-public-${environment}`
      ]
    }));

    // Grant specific Bedrock model access to public Lambda
    this.publicLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel'
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/${bedrockModelId}`
      ]
    }));

    // Create API Gateway
    this.api = new apigateway.RestApi(this, 'BookmarkApi', {
      restApiName: `bookmark-bot-api-${environment}`,
      description: 'API for Slack Bookmark Bot',
      deployOptions: {
        stageName: environment,
        loggingLevel: environment === 'production' 
          ? apigateway.MethodLoggingLevel.ERROR 
          : apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: environment !== 'production',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // Create Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(this.publicLambda, {
      proxy: true,
    });

    // Add Slack events endpoint
    const slackResource = this.api.root.addResource('slack');
    slackResource.addResource('events').addMethod('POST', lambdaIntegration);

    // Add health check endpoint
    const healthResource = this.api.root.addResource('health');
    healthResource.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseTemplates: {
          'application/json': JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            environment
          })
        }
      }],
      requestTemplates: {
        'application/json': '{ "statusCode": 200 }'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseModels: {
          'application/json': apigateway.Model.EMPTY_MODEL
        }
      }]
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
      exportName: `bookmark-bot-api-url-${environment}`
    });

    new cdk.CfnOutput(this, 'SlackWebhookUrl', {
      value: `${this.api.url}slack/events`,
      description: 'Slack webhook URL for bot configuration',
      exportName: `bookmark-bot-slack-webhook-${environment}`
    });

    // VPC and Database exports
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
      exportName: `bookmark-bot-vpc-id-${environment}`
    });

    new cdk.CfnOutput(this, 'PrivateLambdaSGId', {
      value: this.privateLambdaSG.securityGroupId,
      description: 'Private Lambda Security Group ID',
      exportName: `bookmark-bot-private-lambda-sg-${environment}`
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.database.secret!.secretArn,
      description: 'Database secret ARN',
      exportName: `bookmark-bot-database-secret-arn-${environment}`
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.database.instanceEndpoint.hostname,
      description: 'RDS PostgreSQL endpoint',
      exportName: `bookmark-bot-database-endpoint-${environment}`
    });

    new cdk.CfnOutput(this, 'DatabasePort', {
      value: this.database.instanceEndpoint.port.toString(),
      description: 'RDS PostgreSQL port',
      exportName: `bookmark-bot-database-port-${environment}`
    });

    // Private subnet IDs for potential Serverless Framework usage
    const privateSubnets = this.vpc.privateSubnets;
    privateSubnets.forEach((subnet, index) => {
      new cdk.CfnOutput(this, `PrivateSubnet${index + 1}`, {
        value: subnet.subnetId,
        description: `Private subnet ${index + 1} ID`,
        exportName: `bookmark-bot-private-subnet-${index + 1}-${environment}`
      });
    });

    new cdk.CfnOutput(this, 'PublicLambdaArn', {
      value: this.publicLambda.functionArn,
      description: 'Public Lambda function ARN',
      exportName: `bookmark-bot-public-lambda-arn-${environment}`
    });

    new cdk.CfnOutput(this, 'PrivateLambdaArn', {
      value: this.privateLambda.functionArn,
      description: 'Private Lambda function ARN',
      exportName: `bookmark-bot-private-lambda-arn-${environment}`
    });

    // Tags
    cdk.Tags.of(this).add('Project', 'BookmarkBot');
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
}