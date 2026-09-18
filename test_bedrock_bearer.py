import urllib.request
import json
import urllib.parse

# ==========================================
# 1. FILL IN YOUR AWS BEARER TOKEN & REGION
# ==========================================
AWS_BEARER_TOKEN = "ABSKTWFudGxlQXBpS2V5LTJ1N2pkdmFxLWF0LTA1MjQ3Nzg5NTAwMTowdk1tejlPWC9menM0MkF1TndHSUxZVlBUa3ZIVmZpWUlwNllWNVQvbitoUXZIVWFiUHc2d3lIV1RBQT0="
AWS_REGION = "ap-south-1"  # e.g., "us-east-1" or "us-west-2"

# Model ID (Cheapest model with minimal tokens)
MODEL_ID = "amazon.nova-micro-v1:0"
# Alternative: "anthropic.claude-3-haiku-20240307-v1:0"

# ==========================================
# 2. SEND DIRECT HTTP REQUEST WITH BEARER TOKEN
# ==========================================
def test_bedrock():
    print("Testing Amazon Bedrock with Bearer Token...")
    
    encoded_model = urllib.parse.quote(MODEL_ID, safe="")
    url = f"https://bedrock-runtime.{AWS_REGION}.amazonaws.com/model/{encoded_model}/converse"
    
    payload = {
        "messages": [
            {
                "role": "user",
                "content": [{"text": "Say 'Hello' in 1 word."}]
            }
        ],
        "inferenceConfig": {
            "maxTokens": 5,
            "temperature": 0.1
        }
    }
    
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {AWS_BEARER_TOKEN}"
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            res_json = json.loads(res_body)
            output_text = res_json.get("output", {}).get("message", {}).get("content", [{}])[0].get("text", "")
            usage = res_json.get("usage", {})
            
            print("\n✅ Success! Response from Bedrock:")
            print("--------------------------------")
            print(output_text)
            print("--------------------------------")
            print(f"Tokens used - Input: {usage.get('inputTokens')}, Output: {usage.get('outputTokens')}")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"\n❌ Request failed with HTTP {e.code}:")
        print(error_body)
    except Exception as e:
        print(f"\n❌ Error connecting to Bedrock: {e}")

if __name__ == "__main__":
    test_bedrock()
