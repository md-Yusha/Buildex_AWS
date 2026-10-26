/**
 * Direct Lambda Deployment Script
 * Deploys changed Lambda functions without AWS SAM CLI
 */

import { LambdaClient, UpdateFunctionCodeCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import { readFileSync } from 'fs';
import { createWriteStream } from 'fs';
import archiver from 'archiver';
import { promisify } from 'util';
import { pipeline } from 'stream';

const pipelineAsync = promisify(pipeline);

const region = process.env.AWS_REGION || 'ap-south-1';
const lambdaClient = new LambdaClient({ region });

// Map of handler files to Lambda function names
const LAMBDA_FUNCTIONS = {
  'authCallback.js': 'buildex-AuthCallback',
  'chatStream.js': 'buildex-ChatStream'
};

async function zipLambdaFunction(handlerFile) {
  console.log(`📦 Packaging ${handlerFile}...`);
  
  const zipPath = `/tmp/${handlerFile.replace('.js', '')}.zip`;
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.pipe(output);
  
  // Add the handler file
  archive.file(`src/handlers/${handlerFile}`, { name: handlerFile });
  
  // Add shared services (if needed)
  archive.directory('src/services', 'services');
  
  // Add package.json and node_modules
  archive.file('package.json', { name: 'package.json' });
  archive.directory('node_modules', 'node_modules');
  
  await archive.finalize();
  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
  });

  console.log(`✅ Created ${zipPath} (${(archive.pointer() / 1024 / 1024).toFixed(2)} MB)`);
  return zipPath;
}

async function deployFunction(handlerFile, functionName) {
  try {
    console.log(`\n🚀 Deploying ${functionName}...`);
    
    // Check if function exists
    try {
      await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
      console.log(`✅ Function ${functionName} exists`);
    } catch (err) {
      console.error(`❌ Function ${functionName} not found:`, err.message);
      return false;
    }

    // Package the function
    const zipPath = await zipLambdaFunction(handlerFile);
    const zipBuffer = readFileSync(zipPath);

    // Update function code
    const command = new UpdateFunctionCodeCommand({
      FunctionName: functionName,
      ZipFile: zipBuffer
    });

    const response = await lambdaClient.send(command);
    console.log(`✅ Updated ${functionName}`);
    console.log(`   Last Modified: ${response.LastModified}`);
    console.log(`   Code Size: ${(response.CodeSize / 1024).toFixed(2)} KB`);
    
    return true;
  } catch (err) {
    console.error(`❌ Failed to deploy ${functionName}:`, err.message);
    return false;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║        🚀 BuildeX Lambda Direct Deployment                    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Region:', region);
  console.log('');

  let successCount = 0;
  let failCount = 0;

  for (const [handlerFile, functionName] of Object.entries(LAMBDA_FUNCTIONS)) {
    const success = await deployFunction(handlerFile, functionName);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`✅ Successfully deployed: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log('');

  if (failCount === 0) {
    console.log('🎉 All Lambda functions updated successfully!');
    console.log('');
    console.log('✨ Your backend changes are now live!');
    console.log('');
  } else {
    console.log('⚠️  Some functions failed to deploy.');
    console.log('   Check the error messages above.');
    console.log('');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
