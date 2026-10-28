import boto3

region = 'ap-south-1'
poolId = 'ap-south-1_DFJckvu7H'
client = boto3.client('cognito-idp', region_name=region)

# Test client with code + implicit only (no client_credentials)
print("=== Creating test Cognito client (code + implicit flows) ===")
try:
    resp = client.create_user_pool_client(
        UserPoolId=poolId,
        ClientName='BuildexE2ETestClient',
        GenerateSecret=True,
        AllowedOAuthFlows=['implicit', 'code'],
        AllowedOAuthScopes=['email', 'openid', 'profile', 'aws.cognito.signin.user.admin'],
        SupportedIdentityProviders=['COGNITO'],
        CallbackURLs=['https://buildexide.dev', 'https://www.buildexide.dev'],
        LogoutURLs=['https://buildexide.dev'],
    )
    cid = resp['UserPoolClient']['ClientId']
    print(f"PASS - test client created: {cid}")
except Exception as e:
    print(f"create failed: {e}")
    import sys
    sys.exit(1)

print("\nTest client is ready for optional browser E2E. The payment/credits "
      "business logic can be tested directly via the API (userId in body), "
      "which is what production readiness hinges on.")
