/**
 * Clear Test Data from DynamoDB Tables
 * Run this script to reset all tables to production-ready state
 * 
 * Usage: node backend/scripts/clear-test-data.js
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLES = {
  USERS: process.env.DYNAMODB_USERS_TABLE || 'BuildexUsers',
  PROJECTS: process.env.DYNAMODB_PROJECTS_TABLE || 'BuildexProjects',
  SESSIONS: process.env.DYNAMODB_SESSIONS_TABLE || 'BuildexSessions',
  PROGRESS: process.env.DYNAMODB_PROGRESS_TABLE || 'BuildexProgress',
  CHATS: process.env.DYNAMODB_CHATS_TABLE || 'BuildexChats',
  PAYMENTS: 'BuildexPayments'
};

async function clearTable(tableName, keyName) {
  console.log(`\n🔄 Scanning ${tableName}...`);
  
  try {
    const scanResult = await docClient.send(new ScanCommand({
      TableName: tableName
    }));

    const items = scanResult.Items || [];
    console.log(`   Found ${items.length} items`);

    if (items.length === 0) {
      console.log(`   ✓ ${tableName} is already empty`);
      return;
    }

    let deleted = 0;
    for (const item of items) {
      try {
        await docClient.send(new DeleteCommand({
          TableName: tableName,
          Key: { [keyName]: item[keyName] }
        }));
        deleted++;
      } catch (err) {
        console.error(`   ✗ Failed to delete ${item[keyName]}:`, err.message);
      }
    }

    console.log(`   ✓ Deleted ${deleted} items from ${tableName}`);
  } catch (err) {
    console.error(`   ✗ Error clearing ${tableName}:`, err.message);
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║           🧹 CLEAR DYNAMODB TEST DATA                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('⚠️  WARNING: This will DELETE ALL DATA from the following tables:');
  console.log('   • BuildexUsers (all user accounts)');
  console.log('   • BuildexProjects (all project data)');
  console.log('   • BuildexSessions (all auth sessions)');
  console.log('   • BuildexProgress (all user progress)');
  console.log('   • BuildexChats (all chat history)');
  console.log('   • BuildexPayments (all payment records)');
  console.log('');
  console.log('   Region:', process.env.AWS_REGION || 'ap-south-1');
  console.log('');

  // Uncomment the line below to actually run the deletion
  // For safety, this script requires manual confirmation
  console.log('🔒 Safety check: Edit this script and uncomment the deletion code to proceed.');
  console.log('');
  
  /* UNCOMMENT BELOW TO ENABLE DELETION
  
  console.log('🚀 Starting cleanup in 3 seconds... (Press Ctrl+C to cancel)');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  await clearTable(TABLES.CHATS, 'chatId');
  await clearTable(TABLES.SESSIONS, 'sessionId');
  await clearTable(TABLES.PROGRESS, 'userId');
  await clearTable(TABLES.PROJECTS, 'projectId');
  await clearTable(TABLES.PAYMENTS, 'paymentId');
  await clearTable(TABLES.USERS, 'userId');

  console.log('');
  console.log('✅ Database cleanup complete!');
  console.log('');
  console.log('📊 Production-ready state:');
  console.log('   • All tables empty');
  console.log('   • New users will receive 0 credits by default');
  console.log('   • Payment system ready for real transactions');
  console.log('   • Credit tracking active');
  console.log('');
  
  */
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
