import requests, json

apiBase = 'https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com'

# Create a fresh order to test the Razorpay checkout
testUserId = '0173fdca-5061-7036-52c4-d9c829bed8b0'

print("=== Create Razorpay order (start plan, ₹1) ===")
r = requests.post(f"{apiBase}/api/payment/create-order",
                  json={'planId': 'start', 'userId': testUserId, 'userEmail': 'e2e@buildexide.dev'},
                  timeout=15)
order = r.json()
print(f"Status: {r.status_code}")
print(f"Order: {order.get('orderId')}  Amount: ₹{order.get('amount', 0)/100}  Key: {order.get('keyId')}")
print(f"Simulated: {order.get('isSimulated', False)}")
print(f"Plan name (shown in checkout): {order.get('planName')}")

if order.get('isSimulated'):
    print("\nRunning in SIMULATED mode - Razorpay keys not configured.")
    print("Backend needs RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET env vars on the Payment Lambda.")
    exit(0)

print("\n=== Razorpay checkout will show ===")
print("  name: 'BuildeX Coder IDE'  (from frontend app.js)")
print(f"  description: {order.get('planName')}")
print(f"  logo: https://buildexide.dev/assets/logo_transparent.png")
print(f"  amount: ₹{order.get('amount',0)/100}")

print("\n=== Verify signature check still works (bad sig → 400) ===")
r2 = requests.post(f"{apiBase}/api/payment/verify",
                   json={
                       'razorpay_order_id': order.get('orderId'),
                       'razorpay_payment_id': 'pay_fake',
                       'razorpay_signature': 'invalid',
                       'userId': testUserId,
                       'planId': 'start',
                   },
                   timeout=15)
print(f"Status: {r2.status_code} (expect 400)")
print(f"Response: {r2.text[:200]}")
