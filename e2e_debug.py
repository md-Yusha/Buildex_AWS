import requests, json, sys, base64

sub = '0173fdca-5061-7036-52c4-d9c829bed8b0'
client_id = '9jaf2pt50b0b36ddmmjd0h12n'
client_secret = '1uceqg0r6pqk83flgtt0q73ccimnv0c0e1v600gmqt3j62qitm95'
tokenUrl = 'https://cognito-idp.ap-south-1.amazonaws.com/oauth2/token'

# Cognito password grant requires: client_id + client_secret in form body, OR Authorization Basic
print("=== Attempt 1: client_id + client_secret in form body ===")
r1 = requests.post(tokenUrl, data={
    'grant_type': 'password',
    'username': sub,
    'password': 'Test@12345',
    'client_id': client_id,
    'client_secret': client_secret
}, timeout=15)
print(f"Status: {r1.status_code}  Body: {r1.text[:300]}")

print("\n=== Attempt 2: Authorization Basic header ===")
basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
r2 = requests.post(tokenUrl, data={
    'grant_type': 'password',
    'username': sub,
    'password': 'Test@12345'
}, headers={'Authorization': f'Basic {basic}'}, timeout=15)
print(f"Status: {r2.status_code}  Body: {r2.text[:300]}")