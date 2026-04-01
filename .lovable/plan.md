
## Implementation Plan: GitHub Integration & Brownfield Migration

### What we CAN build now (UI + Edge Functions + Dolt mock state):

#### Part I — GitHub Integration
1. **Git Lineage Panel** — New Backstage tab showing deployment→commit linkage (mock data in Dolt client)
2. **GitHub Action YAML Generator** — UI that generates the `naawi-deploy` action config based on user selections
3. **Status Reporter Dashboard** — Deployment lifecycle view mapping Naawi states → GitHub deployment states
4. **PR Simulation View** — Mock PR comment preview showing affected intents & compliance summary

#### Part II — Brownfield Migration Service  
5. **Migration Wizard** (new page `/migrate`) — Multi-step flow:
   - **Step 1: Discovery** — Provider/region selector, credential check, simulated resource scan
   - **Step 2: Intent Inference** — Review queue showing discovered resources → inferred intents with confidence scores
   - **Step 3: Gap Analysis** — Gap report dashboard with severity breakdown, filterable grid
   - **Step 4: Remediation Plan** — Approval queue with diff view (current vs Golden Path target)
   - **Step 5: Import & Registration** — Summary of migrated resources now under Naawi management

6. **Manifest V4 entries** — Add `migrate/discover`, `migrate/infer`, `migrate/analyze`, `migrate/remediate`, `migrate/import` to manifest.json

7. **Edge function updates** — Extend `uidi-engine` with migration intent handlers (mock/simulated responses)

### Files to create/modify:
- `src/pages/Migrate.tsx` — New migration wizard page
- `src/components/migration/DiscoveryPanel.tsx` — Discovery step
- `src/components/migration/IntentInferencePanel.tsx` — Review queue
- `src/components/migration/GapAnalysisPanel.tsx` — Gap report
- `src/components/migration/RemediationPanel.tsx` — Approval & execution
- `src/components/migration/ImportPanel.tsx` — Registration summary
- `src/components/github/GitLineagePanel.tsx` — Lineage viewer
- `src/components/github/ActionGenerator.tsx` — YAML generator
- `src/components/github/StatusReporter.tsx` — Deployment status mapping
- Update `src/App.tsx` with `/migrate` route
- Update `supabase/functions/uidi-engine/manifest.json` with migration entries
- Update Backstage page with GitHub integration tabs

### What's OUT OF SCOPE (requires real GitHub API / multi-account cloud access):
- Actual GitHub Marketplace publishing
- Real cross-account IAM role assumption
- Live cloud API discovery calls
- Real PR comment posting via GitHub API
