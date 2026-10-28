@echo off
"C:\Users\likit\AppData\Roaming\Python\Python312\Scripts\aws.cmd" acm request-certificate --domain-name buildexide.dev --subject-alternative-names www.buildexide.dev --region us-east-1 --output json
