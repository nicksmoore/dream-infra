
# Intent-Driven Infrastructure (IDI) — POC

## Overview
A hybrid UI where users type natural language infrastructure requests, the system parses intent using AI (with rule-based fallback), and provisions EC2 instances via AWS SDK — all without writing any IaC code.

## Pages & Layout

### Main Page — Infrastructure Intent Console
- **Top section**: Natural language input box with placeholder like "Deploy a small dev server for testing"
- **Parsed Intent Panel** (below input): Editable form fields showing:
  - Workload Type (dropdown: General Purpose, Compute Intensive, Memory Intensive)
  - Cost Sensitivity (dropdown: Cheapest, Balanced, Production Grade)
  - Environment (dropdown: Dev, Staging, Prod)
  - Region (dropdown: common AWS regions)
  - OS (dropdown: Amazon Linux 2023, Ubuntu)
- **Config Preview Panel**: Shows the resolved EC2 configuration (instance type, AMI, etc.) in a clean card
- **Deploy button**: Triggers provisioning after user confirms

### AWS Credentials Modal
- On first use, prompt user for AWS Access Key ID and Secret Access Key
- Credentials stored in session only (never persisted)
- Clear credentials button available

### Deployment Status & History
- After deployment: show progress indicator, then Instance ID, public IP, status
- Simple list of past deployments in the current session

## AI Intent Parsing (Lovable AI via Edge Function)
- Edge function receives natural language input
- AI extracts structured JSON: workload type, cost sensitivity, environment
- Fallback: rule-based keyword matching (e.g., "cheap" → Cheapest, "prod" → Production)

## AWS Provisioning (Edge Function)
- Second edge function receives: parsed config + AWS credentials
- Uses AWS SDK (fetch-based calls to AWS EC2 API) to:
  - Look up latest AMI for chosen OS
  - Run instance with mapped instance type
  - Return instance ID and status
- Maps intents to instance types:
  - Cheapest → t3.nano/t3.micro
  - Balanced → t3.medium
  - Production → m5.large
  - Compute Intensive → c5.large
  - Memory Intensive → r5.large

## Key UX Details
- Typing in the natural language box auto-parses and fills the form fields
- User can override any parsed field before deploying
- Clear confirmation step showing exactly what will be provisioned
- Toast notifications for success/errors
- Responsive design for mobile and desktop
