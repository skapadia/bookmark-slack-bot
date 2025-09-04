#!/usr/bin/env node

/**
 * Build verification script
 * Ensures all packages build successfully and CDK can synthesize
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const REQUIRED_PACKAGES = [
  'packages/shared',
  'packages/core', 
  'packages/lambda-public',
  'packages/lambda-private',
  'packages/infrastructure'
];

const REQUIRED_BUILD_OUTPUTS = [
  'packages/shared/dist',
  'packages/core/dist',
  'packages/lambda-public/dist',
  'packages/lambda-private/dist',
  'packages/infrastructure/dist'
];

function runCommand(command, description) {
  console.log(`🔧 ${description}...`);
  try {
    execSync(command, { stdio: 'pipe', cwd: process.cwd() });
    console.log(`✅ ${description} - Success`);
    return true;
  } catch (error) {
    console.error(`❌ ${description} - Failed`);
    console.error(error.stdout?.toString() || error.message);
    return false;
  }
}

function checkFileExists(filePath, description) {
  console.log(`📁 Checking ${description}...`);
  if (existsSync(filePath)) {
    console.log(`✅ ${description} - Found`);
    return true;
  } else {
    console.error(`❌ ${description} - Missing: ${filePath}`);
    return false;
  }
}

async function verifyBuild() {
  console.log('🚀 Starting build verification...\n');

  let allPassed = true;

  // 1. Clean previous builds
  allPassed &= runCommand('npm run clean', 'Cleaning previous builds');

  // 2. Install dependencies
  allPassed &= runCommand('npm install', 'Installing dependencies');

  // 3. Build all packages first (needed for type resolution)
  allPassed &= runCommand('npm run build', 'Building all packages');

  // 4. Type check all packages (after build for module resolution)
  allPassed &= runCommand('npm run type-check', 'Type checking all packages');

  // 5. Check build outputs exist
  console.log('\n📦 Verifying build outputs...');
  for (const outputPath of REQUIRED_BUILD_OUTPUTS) {
    allPassed &= checkFileExists(outputPath, `Build output: ${outputPath}`);
  }

  // 6. Run core package tests
  allPassed &= runCommand('npm run test -w packages/core', 'Running core package tests');

  // 7. CDK synthesis test
  console.log('\n☁️  Testing AWS infrastructure...');
  process.chdir('packages/infrastructure');
  
  // Set required environment variables for CDK synth
  process.env.SLACK_BOT_TOKEN = 'test-token-for-synth';
  process.env.SLACK_SIGNING_SECRET = 'test-secret-for-synth';
  
  allPassed &= runCommand('npm run synth', 'CDK infrastructure synthesis');
  
  // Check CDK output exists
  allPassed &= checkFileExists('cdk.out', 'CDK synthesis output');
  
  process.chdir('../..');

  // 8. Lint check
  allPassed &= runCommand('npm run lint', 'Linting all packages');

  console.log('\n' + '='.repeat(50));
  
  if (allPassed) {
    console.log('🎉 Build verification PASSED!');
    console.log('✅ All packages built successfully');
    console.log('✅ Type checking passed');
    console.log('✅ Tests passed');
    console.log('✅ CDK synthesis passed');
    console.log('✅ Linting passed');
    console.log('\n📋 Next steps:');
    console.log('   1. Set up environment variables (.env)');
    console.log('   2. Deploy infrastructure: npm run deploy:dev -w packages/infrastructure');
    console.log('   3. Initialize database: npm run init-db:dev');
    process.exit(0);
  } else {
    console.log('💥 Build verification FAILED!');
    console.log('❌ Some checks failed - see errors above');
    console.log('\n🔧 Try fixing the issues and run again:');
    console.log('   npm run verify-build');
    process.exit(1);
  }
}

verifyBuild().catch(error => {
  console.error('💥 Verification script failed:', error);
  process.exit(1);
});