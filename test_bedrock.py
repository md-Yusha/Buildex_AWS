import json
import boto3

# ==========================================
# 1. FILL IN YOUR AWS BEDROCK CREDENTIALS
# ==========================================
AWS_REGION = "ap-south-1"  # e.g., "us-east-1" or "us-west-2"
AWS_ACCESS_KEY_ID = "AKIAQYN7NEFMSJQFRY2O"
AWS_SECRET_ACCESS_KEY = "2WL2XGVIUxZkkqrSIn3kkGWvDoDDXm7Spcm6nZXe"
AWS_SESSION_TOKEN = "ABSKTWFudGxlQXBpS2V5LTJ1N2pkdmFxLWF0LTA1MjQ3Nzg5NTAwMTowdk1tejlPWC9menM0MkF1TndHSUxZVlBUa3ZIVmZpWUlwNllWNVQvbitoUXZIVWFiUHc2d3lIV1RBQT0="  # Optional: Leave empty if you don't use temporary session tokens

# Model IDs:
# - "amazon.nova-micro-v1:0" (cheapest Amazon model)
# - "anthropic.claude-3-haiku-20240307-v1:0" (very low cost Claude)
# - "amazon.titan-text-express-v1"
MODEL_ID = "amazon.nova-micro-v1:0"

# ==========================================
# 2. INITIALIZE BEDROCK CLIENT
# ==========================================
session_kwargs = {
        "region_name": AWS_REGION,
        "aws_access_key_id": AWS_ACCESS_KEY_ID,
    "aws_secret_access_key": AWS_SECRET_ACCESS_KEY,
}
if AWS_SESSION_TOKEN:
    session_kwargs["aws_session_token"] = AWS_SESSION_TOKEN

client = boto3.client("bedrock-runtime", **session_kwargs)

def test_bedrock():
    print("Testing Amazon Bedrock connection...")
    try:
        # Minimal prompt and strictly 5 max tokens to minimize credit usage
        response = client.converse(
            modelId=MODEL_ID,
            messages=[
                {
                    "role": "user",
                    "content": [{"text": "Say 'Hello' in 1 word."}],
                }
            ],
            inferenceConfig={
                "maxTokens": 5,
                "temperature": 0.1,
            },
        )
        
        output_text = response["output"]["message"]["content"][0]["text"]
        usage = response.get("usage", {})
        
        print("\n✅ Success! Response from Bedrock:")
        print("--------------------------------")
        print(output_text)
        print("--------------------------------")
        print(f"Tokens used - Input: {usage.get('inputTokens')}, Output: {usage.get('outputTokens')}")
    except Exception as e:
        print(f"\n❌ Error connecting to Amazon Bedrock: {e}")

if __name__ == "__main__":
    test_bedrock()
