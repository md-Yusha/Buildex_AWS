import crypto from 'crypto';
import Razorpay from 'razorpay';
import { docClient, TABLES } from '../services/dynamo.js';
import { PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'ap-south-1'
});

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || 'ap-south-1_DFJckvu7H';

// Plan definitions
const PLANS = {
  start: {
    id: 'start',
    name: 'BuildeX Start Plan',
    amount: 649, // INR
    amountPaise: 64900,
    credits: 2000,
    tier: 'pro',
    cognitoGroup: 'ProTier'
  },
  enterprise: {
    id: 'enterprise',
    name: 'BuildeX Enterprise Plan',
    amount: 1999, // INR
    amountPaise: 199900,
    credits: 10000,
    tier: 'enterprise',
    cognitoGroup: 'EnterpriseTier'
  }
};

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key'
};

function getRazorpayClient() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret || key_id.includes('placeholder') || key_id.includes('YOUR_')) {
    return null;
  }

  return {
    client: new Razorpay({ key_id, key_secret }),
    keyId: key_id,
    keySecret: key_secret
  };
}

export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const path = event.requestContext?.http?.path || event.path || '';

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  try {
    let body = {};
    if (event.body) {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    }

    // Route 1: Create Order (/api/payment/create-order)
    if (path.endsWith('/create-order') && method === 'POST') {
      return await handleCreateOrder(body);
    }

    // Route 2: Verify Payment (/api/payment/verify)
    if (path.endsWith('/verify') && method === 'POST') {
      return await handleVerifyPayment(body);
    }

    // Route 3: Public Config / Status (/api/payment/config)
    if (path.endsWith('/config') && method === 'GET') {
      const rzp = getRazorpayClient();
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          ok: true,
          configured: !!rzp,
          keyId: rzp ? rzp.keyId : (process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder'),
          plans: PLANS
        })
      };
    }

    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, error: `Route not found: ${method} ${path}` })
    };
  } catch (err) {
    console.error('Payment handler error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, error: err.message || 'Internal server error' })
    };
  }
}

/**
 * Creates a Razorpay Order and records a PENDING transaction in DynamoDB
 */
async function handleCreateOrder(body) {
  const { planId = 'start', userId = 'anonymous_user', userEmail = '' } = body;
  const plan = PLANS[planId] || PLANS.start;

  const rzp = getRazorpayClient();
  const receipt = `rcpt_${userId.slice(0, 8)}_${Date.now()}`;

  let orderId;
  let isSimulated = false;

  if (rzp) {
    // Real Razorpay API Order Creation
    const order = await rzp.client.orders.create({
      amount: plan.amountPaise,
      currency: 'INR',
      receipt,
      notes: {
        userId,
        planId: plan.id,
        userEmail
      }
    });
    orderId = order.id;
  } else {
    // Graceful test/mock simulator when credentials will be provided later
    orderId = `order_sim_${Date.now()}`;
    isSimulated = true;
    console.log(`[Payment] Razorpay keys not set or placeholder. Using simulated order ${orderId}`);
  }

  // Register pending record in BuildexPayments table
  try {
    await docClient.send(new PutCommand({
      TableName: TABLES.PAYMENTS,
      Item: {
        paymentId: `PENDING_${orderId}`,
        orderId,
        userId,
        userEmail,
        planId: plan.id,
        amount: plan.amount,
        currency: 'INR',
        status: 'PENDING',
        isSimulated,
        createdAt: new Date().toISOString()
      }
    }));
  } catch (dbErr) {
    console.warn('[Payment] Warning writing pending payment to DynamoDB:', dbErr.message);
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      ok: true,
      orderId,
      amount: plan.amountPaise,
      currency: 'INR',
      planId: plan.id,
      planName: plan.name,
      keyId: rzp ? rzp.keyId : (process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder'),
      isSimulated
    })
  };
}

/**
 * Validates HMAC SHA-256 signature, stores payment in DynamoDB, and syncs tier to Cognito
 */
async function handleVerifyPayment(body) {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    userId,
    planId = 'start'
  } = body;

  if (!razorpay_order_id || !razorpay_payment_id) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, error: 'Missing razorpay_order_id or razorpay_payment_id' })
    };
  }

  const plan = PLANS[planId] || PLANS.start;
  const rzp = getRazorpayClient();

  let verified = false;

  if (rzp && razorpay_signature) {
    // Cryptographic HMAC-SHA256 verification (standard Razorpay formula)
    const expectedSignature = crypto
      .createHmac('sha256', rzp.keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    verified = (expectedSignature === razorpay_signature);
  } else {
    // Simulator mode (when real credentials will be provided later)
    verified = razorpay_order_id.startsWith('order_sim_') || !rzp;
  }

  if (!verified) {
    console.error(`[Payment] Invalid signature for order ${razorpay_order_id}`);
    try {
      await docClient.send(new PutCommand({
        TableName: TABLES.PAYMENTS,
        Item: {
          paymentId: razorpay_payment_id || `FAILED_${Date.now()}`,
          orderId: razorpay_order_id,
          userId: userId || 'unknown',
          status: 'FAILED',
          failedAt: new Date().toISOString()
        }
      }));
    } catch (_) {}

    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, error: 'Invalid payment signature' })
    };
  }

  const now = new Date().toISOString();

  // 1. Store Verified Transaction in DynamoDB BuildexPayments
  try {
    await docClient.send(new PutCommand({
      TableName: TABLES.PAYMENTS,
      Item: {
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        userId,
        planId: plan.id,
        amount: plan.amount,
        currency: 'INR',
        status: 'SUCCESS',
        signature: razorpay_signature || 'simulated_sig',
        verifiedAt: now,
        createdAt: now
      }
    }));
  } catch (err) {
    console.error('[Payment] Error storing payment in DynamoDB:', err);
  }

  // 2. Upgrade User Tier & Credits in DynamoDB BuildexUsers
  let updatedUser = null;
  try {
    const updateRes = await docClient.send(new UpdateCommand({
      TableName: TABLES.USERS,
      Key: { userId },
      UpdateExpression: `
        SET tier = :tier,
            creditsTotal = :creditsTotal,
            creditsRemaining = if_not_exists(creditsRemaining, :zero) + :addCredits,
            subscriptionStatus = :subStatus,
            lastPaymentId = :paymentId,
            lastPaymentDate = :now,
            updatedAt = :now
      `,
      ExpressionAttributeValues: {
        ':tier': plan.tier,
        ':creditsTotal': plan.credits,
        ':addCredits': plan.credits,
        ':zero': 0,
        ':subStatus': 'ACTIVE',
        ':paymentId': razorpay_payment_id,
        ':now': now
      },
      ReturnValues: 'ALL_NEW'
    }));
    updatedUser = updateRes.Attributes;
  } catch (err) {
    console.error('[Payment] Error updating user in DynamoDB:', err);
  }

  // 3. Sync User Authorization to AWS Cognito User Pool Group
  if (userId && userId !== 'anonymous_user') {
    try {
      await cognitoClient.send(new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
        GroupName: plan.cognitoGroup
      }));
      console.log(`[Cognito] Successfully added user ${userId} to Cognito group ${plan.cognitoGroup}`);
    } catch (cogErr) {
      console.warn(`[Cognito] Could not add user to group ${plan.cognitoGroup}:`, cogErr.message);
    }
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      ok: true,
      success: true,
      message: `Successfully upgraded to ${plan.name}`,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      plan: plan.id,
      tier: plan.tier,
      creditsGranted: plan.credits,
      user: updatedUser
    })
  };
}
