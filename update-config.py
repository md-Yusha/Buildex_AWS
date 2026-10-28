import json
with open('D:/Buildex_AWS/cf-dist-config.json') as f:
    data = json.load(f)
config = data['DistributionConfig']
config['Aliases'] = {
    "Quantity": 1,
    "Items": ["buildexide.dev"]
}
config['ViewerCertificate'] = {
    "ACMCertificateArn": "arn:aws:acm:us-east-1:052477895001:certificate/678acdc4-0d2a-4832-b3f2-25f319f310a9",
    "CertificateSource": "acm",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021",
    "CloudFrontDefaultCertificate": False
}
with open('D:/Buildex_AWS/cf-update.json', 'w') as f:
    json.dump(config, f, indent=2)
print("Ready")