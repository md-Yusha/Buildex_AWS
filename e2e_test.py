import boto3, json, sys, base64, urllib.request, urllib.parse, urllib.error

region = 'ap-south-1'
poolId = 'ap-south-1_DFJckvu7H'
testClientId = '9jaf2pt50b0b36ddmmjd0h12n'
sub = '0173fdca-5061-7036-52c4-d9c829bed8b0'
apiBase = 'https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com'
tokenUrl = f'https://cognito-idp.{region}.amazonaws.com/oauth2/token'

client = boto3.client('cognito-idp', region_name=region)

# STEP 0: Enable RESOURCE_OWNER_PASSWORD on the test client
print("=== STEP 0: Enable resource-owner-password grant on test client ===")
try:
    client.update_user_pool_client(
        UserPoolId=poolId,
        ClientId=testClientId,
        AllowedOAuthFlows=['CODE', 'RESOURCE_OWNER_PASSWORD'],
        AllowedOAuthScopes=['email', 'openid', 'profile', 'aws.cognito.signin.user.admin'],
    )
    print("PASS - Enabled RESOURCE_OWNER_PASSWORD flow")
except Exception as e:
    print(f"Note: {e}")
    print("(May already be enabled or use a different method)")

# Verify
desc = client.describe_user_pool_client(UserPoolId=poolId, ClientId=testClientId)
print(f"Allowed flows: {desc['UserPoolClient'].get('AllowedOAuthFlows')}")

# STEP 1: Get access token via password grant (Basic auth)
print("\n=== STEP 1: Get Cognito access token (password grant, Basic auth) ===")
basic_auth = base64.b64encode(f"{testClientId}:1uceqg0r6pqk83flgtt0q73ccimnv0c0e1v600gmqt3j62qitm95".encode()).decode()
try:
    data = urllib.parse.urlencode({
        'grant_type': 'password',
        'username': sub,
        'password': 'Test@12345',
    }).encode()
    req = urllib.request.Request(
        tokenUrl,
        data=data,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': f'Basic {basic_auth}',
        },
        method='POST'
    )
    resp = urllib.request.urlopen(req, timeout=15)
    token = json.loads(resp.read().decode())
    accessToken = token.get('access_token')
    print(f"PASS - Access token: {accessToken[:30]}...")
except urllib.error.HTTPError as e:
    print(f"FAIL - {e.code}")
    print(f"Error: {e.read().decode()[:500]}")
    sys.exit(1)
except Exception as e:
    print(f"FAIL - {e}")
    sys.exit(1)

# STEP 2: Verify token via Cognito UserInfo
print("\n=== STEP 2: Verify token via Cognito UserInfo ===")
try:
    import requests
    r = requests.get(f"https://cognito-idp.{region}.amazonaws.com/oauth2/userinfo",
                    headers={'Authorization': f'Bearer {accessToken}'},
                    timeout=15)
    print(f"Status: {r.status_code}")
    print(f"User: {json.dumps(r.json(), indent=2)}")
except Exception as e:
    print(f"FAIL - {e}")

# STEP 3: Test chat/stream with token (expect 402 since new user has 0 credits)
print("\n=== STEP 3: Test chat/stream (expect 402 - no credits) ===")
import requests
chatBody = {
    'message': 'Hello E2E test',
    'model': 'amazon.nova-micro-v1:0',
    'userId': sub,
}
try:
    r2 = requests.post(f"{apiBase}/api/chat/stream",
                       json=chatBody,
                       headers={'Authorization': f'Bearer {accessToken}',
                                'Content-Type': 'application/json'},
                       timeout=30)
    print(f"Status: {r2.status_code}")
    if r2.status_code == 402:
        print(f"PASS - 402 as expected (user has 0 credits)")
        print(f"Response: {r2.text[:300]}")
    elif r2.status_code == 200:
        print(f"PASS - Chat succeeded (user has credits)")
        print(f"Response: {r2.text[:300]}")
    else:
        print(f"FAIL - Unexpected: {r2.status_code}")
        print(f"Response: {r2.text[:300]}")
except Exception as e:
    print(f"FAIL - {e}")

# STEP 4: Check user progress / credits
print("\n=== STEP 4: Check user credits ===")
try:
    r4 = requests.get(f"{apiBase}/api/user/progress",
                      headers={'Authorization': f'Bearer {accessToken}'},
                      timeout=15)
    print(f"Status: {r4.status_code}")
    print(f"Credits: {r4.text[:300]}")
except Exception as e:
    print(f"FAIL - {e}")

# STEP 5: Test payment create-order
print("\n=== STEP 5: Test payment create-order ===")
try:
    r3 = requests.post(f"{apiBase}/api/payment/create-order",
                       json={'planId': 'start', 'userId': sub},
                       headers={'Authorization': f'Bearer {accessToken}',
                                'Content-Type': 'application/json'},
                       timeout=15)
    print(f"Status: {r3.status_code}")
    print(f"Response: {r3.text[:400]}")
except Exception as e:
    print(f"FAIL - {e}")
