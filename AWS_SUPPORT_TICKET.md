# AWS Support Ticket - CloudFront CNAME Release

Copy-paste this into your AWS Support ticket.

---

## Category
CloudFront

## Subject
Request to release stale CNAME claim on buildexide.dev blocking new distribution

## Description

I'm unable to attach the custom domain `buildexide.dev` to my CloudFront distribution because AWS reports the CNAME is "already associated with a different resource." However, the distribution that currently owns this CNAME does not appear in my account's distribution list, so I cannot invalidate its cache or remove the alias.

### Context
- **AWS Account ID:** 052477895001
- **New distribution (working, in my account):** `EUCIUOCE1DAKC`
  - ARN: `arn:aws:cloudfront::052477895001:distribution/EUCIUOCE1DAKC`
  - Domain: `d26hu9k0rkp1kt.cloudfront.net`
  - Origin: S3 bucket `buildex-ide-web-052477895001`
  - Status: Deployed

### The Problem
When I call `UpdateDistribution` to add `buildexide.dev` and `www.buildexide.dev` as alternate domain names (aliases) to `EUCIUOCE1DAKC`, I get:

```
An error occurred (CNAMEAlreadyExists) when calling the UpdateDistribution operation:
One or more of the CNAMEs you provided are already associated with a different resource.
```

The CNAME for `buildexide.dev` was previously associated with an older CloudFront distribution (domain `drf58mw5sksg7.cloudfront.net`) that is no longer visible in my account's `ListDistributions` output. That old distribution appears to have been deleted, but its CNAME claim persists.

### Impact
- `https://buildexide.dev` currently serves **stale cached content** from the old distribution (Last-Modified: 20 Sep 2026)
- My new distribution `d26hu9k0rkp1kt.cloudfront.net` serves the correct, up-to-date content
- DNS at Name.com is already pointing `buildexide.dev` CNAME → `d26hu9k0rkp1kt.cloudfront.net`
- The per-hostname cache on the old distribution cannot be invalidated because I no longer have access to it

### Request
Please:
1. Investigate which CloudFront resource (distribution) still holds the CNAME claim on `buildexide.dev` and `www.buildexide.dev`
2. Release / delete that stale claim so I can attach these CNAMEs to my new distribution `EUCIUOCE1DAKC`
3. Confirm when the CNAMEs are free, so I can complete the configuration

### Technical Details
- ACM Certificate (already ISSUED, us-east-1): `arn:aws:acm:us-east-1:052477895001:certificate/678acdc4-0d2a-4832-b3f2-25f319f310a9`
  - Domains: buildexide.dev, www.buildexide.dev
  - InUseBy: arn:aws:cloudfront::052477895001:distribution/EUCIUOCE1DAKC

---

## How to File

1. Go to https://console.aws.amazon.com/support/home
2. **Create a support case**
3. Service: **CloudFront**
4. Case type: **Technical** (or "How-to" if no critical case available)
5. Severity: **Business is down** if your account has it, else **Production system impaired**
6. Paste the description above
7. Add the cert ARN (find it in `acm-cert-arn.txt` in your project)

## What I'll Do When They Reply

Once AWS confirms the CNAMEs are released, I'll:
1. Add `buildexide.dev` + `www.buildexide.dev` as aliases to `EUCIUOCE1DAKC`
2. Attach the ACM certificate
3. Invalidate the CloudFront cache
4. Verify `https://buildexide.dev` serves the clean content
