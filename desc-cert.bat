@echo off
setlocal enabledelayedexpansion
for /f "tokens=*" %%a in ('powershell -Command "& .\list-certs.bat | ConvertFrom-Json | ForEach-Object { $_.CertificateSummaryList | Where-Object { $_.DomainName -eq 'buildexide.dev' } | ForEach-Object { $_.CertificateArn } }"') do set ARN=%%a
if defined ARN (
  "C:\Users\likit\AppData\Roaming\Python\Python312\Scripts\aws.cmd" acm describe-certificate --certificate-arn !ARN! --region us-east-1 --output json
) else (
  echo CERT_NOT_FOUND
)
