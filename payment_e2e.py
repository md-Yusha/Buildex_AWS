import requests, json

apiBase = 'https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com'

# 1. Confirm test prices are live in config
print("=== 1. Payment config (verify ₹1 / ₹2 test prices) ===")
r = requests.get(f"{apiBase}/api/payment/config", timeout=15)
cfg = r.json()
print(f"configured: {cfg.get('configured')}")
print(f"keyId: {cfg.get('keyId')}")
for p in cfg.get('plans', {}).values():
    print(f"  {p['id']}: ₹{p.get('amount')} ({p.get('amountPaise')} paise), {p.get('credits')} credits, tier={p.get('tier')}")

# 2. Create a real Razorpay order for the start plan (₹1)
print("\n=== 2. Create Razorpay order (start plan, ₹1) ===")
testUserId = '0173fdca-5061-7036-52c4-d9c829bed8b0'
r = requests.post(f"{apiBase}/api/payment/create-order",
                  json={'planId': 'start', 'userId': testUserId, 'userEmail': 'e2e@buildexide.dev'},
                  timeout=15)
print(f"Status: {r.status_code}")
order = r.json()
print(json.dumps(order, indent=2)[:500])
orderId = order.get('orderId')
isSimulated = order.get('isSimulated', False)
print(f"orderId: {orderId}  (simulated={isSimulated})")

# 3. Test signature verification with a deliberately bad signature (should reject)
print("\n=== 3. Verify with BAD signature (expect 400) ===")
r = requests.post(f"{apiBase}/api/payment/verify",
                  json={
                      'razorpay_order_id': orderId or 'order_sim_test',
                      'razorpay_payment_id': 'pay_fake_test',
                      'razorpay_signature': 'bad_signature_123',
                      'userId': testUserId,
                      'planId': 'start',
                  },
                  timeout=15)
print(f"Status: {r.status_code} (expect 400 - bad sig rejected)")
print(f"Body: {r.text[:300]}")

# 4. If simulated mode, verify the simulated path grants credits
if isSimulated:
    print("\n=== 4. Simulated verify (expect credit grant) ===")
    r = requests.post(f"{apiBase}/api/payment/verify",
                      json={
                          'razorpay_order_id': orderId,
                          'razorpay_payment_id': 'pay_sim_test',
                          'userId': testUserId,
                          'planId': 'start',
                      },
                      timeout=15)
    print(f"Status: {r.status_code}")
    print(f"Body: {r.text[:400]}")
