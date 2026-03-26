# Multi-Cloud Intent Engine — Design Spec
**Date:** 2026-03-25
**Status:** Approved — ready for implementation

## Problem
The UIDI edge function is an AWS monolith. OCI, GCP, and Azure golden paths hit AWS APIs (false positives on preflight, wrong resource data in discover).

## Decision Log

| Decision | Alternatives | Rationale |
|---|---|---|
| Option A: Intent-Centric factory | Option B: Provider-Centric new intents | Frontend stays generic; edge function is the cross-cloud abstraction layer |
| Raw HTTP + manual signing (no SDK) | SDK dependencies | Matches existing AWS pattern; zero Deno import bloat |
| `spec.provider` as routing discriminator | New intent strings | Zero frontend intent changes; one entry point per lifecycle stage |
| OCI first (most complex auth) | GCP or Azure first | RSA Signature V1 is the hardest; unblocks the pattern for OAuth providers |

## Architecture

```
Frontend mapResourceToIntent
  intent: "network" | "eks" | "compute"
  spec: { ...resourceSpec, provider: "aws" | "oci" | "gcp" | "azure" }
         ↓
Edge Function handleNetwork(action, spec)
  switch (spec.provider)
    "aws"   → existing SigV4 VPC stack
    "oci"   → ociNetwork(action, spec)   ← RSA-SHA256 Signature V1
    "gcp"   → gcpNetwork(action, spec)   ← OAuth2 JWT → access_token
    "azure" → azureNetwork(action, spec) ← Client Credentials → Bearer token
```

## Auth Contracts

### OCI — HTTP Signature V1 (RSA-SHA256)
```
Authorization: Signature algorithm="rsa-sha256",
  headers="(request-target) host date x-content-sha256 content-type content-length",
  keyId="{tenancy_ocid}/{user_ocid}/{fingerprint}",
  signature="{base64(RSA-SHA256(signingString, privateKey))}"
```
Spec fields: `oci_tenancy_ocid`, `oci_user_ocid`, `oci_fingerprint`, `oci_private_key`, `oci_region`, `oci_compartment_id`

### GCP — OAuth2 JWT Service Account
```
JWT → POST oauth2.googleapis.com/token → access_token
Authorization: Bearer {access_token}
```
Spec fields: `gcp_service_account_json` (full JSON key), `gcp_project_id`, `gcp_region`

### Azure — Client Credentials Grant
```
POST login.microsoftonline.com/{tenant}/oauth2/v2.0/token → access_token
Authorization: Bearer {access_token}
```
Spec fields: `azure_client_id`, `azure_client_secret`, `azure_tenant_id`, `azure_subscription_id`, `azure_region`, `azure_resource_group`

## Handler Matrix

| Action | OCI | GCP | Azure |
|---|---|---|---|
| `network/dry_run` | GET /vcns (credential check) | GET /networks (credential check) | GET VNets (credential check) |
| `network/discover` | GET /vcns?compartmentId | GET /networks | GET /virtualNetworks |
| `network/deploy` | POST /vcns + subnets + IGW + RT + SL | POST /networks + subnetworks + firewall | PUT /virtualNetworks + subnets + NSG |
| `network/destroy` | DELETE cascade (SL→RT→subnet→IGW→VCN) | DELETE cascade | DELETE VNet |
| `eks/dry_run` | GET /clusters (credential check) | GET /clusters | GET managedClusters |
| `eks/discover` | GET /clusters?compartmentId | GET /clusters (all locations) | GET managedClusters |
| `eks/deploy` | POST /clusters (OKE) | POST /clusters (GKE) | PUT /managedClusters (AKS) |
| `eks/destroy` | DELETE cluster + node pools | DELETE cluster | DELETE managedCluster |
| `compute/dry_run` | GET /instances | GET /instances | GET virtualMachines |
| `compute/discover` | GET /instances | GET /instances | GET virtualMachines |
| `compute/deploy` | POST /instances | POST /instances | PUT /virtualMachines |
| `compute/destroy` | DELETE instance | DELETE instance | DELETE virtualMachine |

## API Endpoints

### OCI (iaas.{region}.oraclecloud.com — API version 20160918)
- VCN: `/20160918/vcns`
- Subnets: `/20160918/subnets`
- IGW: `/20160918/internetGateways`
- NAT GW: `/20160918/natGateways`
- Route Tables: `/20160918/routeTables`
- Security Lists: `/20160918/securityLists`
- OKE: `containerengine.{region}.oraclecloud.com/20180222/clusters`

### GCP (compute.googleapis.com)
- Networks: `/compute/v1/projects/{project}/global/networks`
- Subnetworks: `/compute/v1/projects/{project}/regions/{region}/subnetworks`
- Firewalls: `/compute/v1/projects/{project}/global/firewalls`
- Cloud NAT/Router: `/compute/v1/projects/{project}/regions/{region}/routers`
- GKE: `container.googleapis.com/v1/projects/{project}/locations/{region}/clusters`

### Azure (management.azure.com — api-version 2023-04-01)
- VNet: `/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Network/virtualNetworks/{name}`
- NSG: `/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Network/networkSecurityGroups/{name}`
- AKS: `api-version 2023-04-02-preview — /providers/Microsoft.ContainerService/managedClusters`

## Implementation Order
1. Auth signing functions (ociSign, gcpGetToken, azureGetToken)
2. handleNetwork factory fork + OCI/GCP/Azure network handlers
3. handleEks factory fork + OKE/GKE/AKS handlers
4. handleCompute factory fork + OCI/GCP/Azure compute handlers
5. Frontend: mapResourceToIntent passes `provider` in spec

## Success Criteria
- OCI VPC Foundation preflight returns real VCN data, not AWS VPC IDs
- GCP Web Standard preflight returns real GKE/VPC data
- Azure Container Platform preflight returns real AKS/VNet data
- Zero new intent strings introduced
- Existing AWS paths unaffected
