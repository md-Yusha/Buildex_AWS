import boto3, json, sys

region = 'ap-south-1'
poolId = 'ap-south-1_DFJckvu7H'
mainClientId = '1t0auvpbcr0lb9eb5c3tdunog5'
testClientId = '9jaf2pt50b0b36ddmmjd0h12n'

client = boto3.client('cognito-idp', region_name=region)

# Enable RESOURCE_OWNER_PASSWORD grant on the main client
print("=== Enabling resource-owner-password grant on main client ===")
try:
    client.update_user_pool_client(
        UserPoolId=poolId,
        ClientId=mainClientId,
        AllowedOAuthFlows=['CODE', 'RESOURCE_OWNER_PASSWORD'],
        AllowedOAuthScopes=['email', 'openid', 'profile', 'aws.cognito.signin.user.admin'],
    )
    print("PASS - main client updated")
except Exception as e:
    print(f"main client update: {e}")

# Also enable on the test client
try:
    client.update_user_pool_client(
        UserPoolId=poolId,
        ClientId=testClientId,
        AllowedOAuthFlows=['CODE', 'RESOURCE_OWNER_PASSWORD'],
        AllowedOAuthScopes=['email', 'openid', 'profile', 'aws.cognito.signin.user.admin'],
    )
    print("PASS - test client updated")
except Exception as e:
    print(f"test client update: {e}")

# Verify both
for cid, label in [(mainClientId, 'main'), (testClientId, 'test')]:
    desc = client.describe_user_pool_client(UserPoolId=poolId, ClientId=cid)
    flows = desc['UserPoolClient'].get('AllowedOAuthFlows', [])
    status = "OK" if 'RESOURCE_OWNER_PASSWORD' in flows else "MISSING"
    print(f"{label} client flows: {flows}  [{status}]")
