# RHSTOR-9511 — Consuming MCO's S3Configuration API: work log, CR reference, test results

**Date:** 2026-11-10
**Console PR:** [red-hat-storage/odf-console#3375](https://github.com/red-hat-storage/odf-console/pull/3375) (open)
**Console branch:** `rhstor-9511-s3configuration` (squashed to `65d954b8`)
**Test hub:** `dr2-nov-10-26` (ACM hub) + managed clusters `local-cluster`, `dr1-nov-10-26`

---

## 1. Background

MCO moved S3 configuration into its own cluster-scoped CRD under
[RHSTOR-9688](https://issues.redhat.com/browse/RHSTOR-9688) (epic
[RHSTOR-8997](https://issues.redhat.com/browse/RHSTOR-8997)), merged between 2026-10-07 and
2026-11-05. The `S3Configuration` controller now owns the Ramen credential secret, the
`s3StoreProfiles` entry in `ramen-hub-operator-config`, and the `DRCluster` for every managed
cluster it covers.

Two facts make console changes mandatory rather than optional:

1. `MirrorPeer.spec.manageS3` is **deprecated**; the MirrorPeer controller no longer creates
   DRClusters or S3 profiles (removed in MCO PR #527, −2328 lines).
2. **Nothing auto-creates an `S3Configuration` for a new setup.** The only automatic creation is a
   5.0→5.1 upgrade migration in `mirrorpeer_controller.go`.

Against MCO 5.1, a DRPolicy created by the pre-change console therefore gets no DRCluster and no S3
profile, on **both** the Data Foundation and third-party paths.

---

## 2. Custom resource reference

All examples below are the real objects from the test hub, not illustrations.

### 2.1 `S3Configuration` (new)

`multicluster.odf.openshift.io/v1alpha1`, plural `s3configurations`, **cluster-scoped**,
status subresource. Owned-CRD in the CSV; displayName "S3 Configuration".

The whole spec is immutable by CEL — `internalS3`, `externalS3` and `managedClusters` all carry
transition rules, and the type cannot be switched. It is create-or-delete only; credential rotation
means editing the referenced secret, never the CR.

**Load-bearing naming:** `metadata.name` becomes the Ramen `s3ProfileName`, the name of the Ramen
credential secret, and `DRCluster.spec.s3ProfileName`.

Internal (OBC-provisioned) form, as produced by the migration on the test hub:

```yaml
apiVersion: multicluster.odf.openshift.io/v1alpha1
kind: S3Configuration
metadata:
  name: s3profile-local-cluster-ocs-storagecluster
  annotations:
    multicluster.odf.openshift.io/migrated-from-mirrorpeer: mirrorpeer-sample
  finalizers:
    - multicluster.odf.openshift.io/s3configuration
  labels:
    cluster.open-cluster-management.io/backup: ''        # hub-recovery label
spec:
  internalS3:
    providerCluster: local-cluster                        # OBC created here only
    storageClassName: openshift-storage.noobaa.io         # == "<namespace>.noobaa.io"
    namespace: openshift-storage                          # storage cluster ns on the spoke
    obcName: odrbucket-1dcd0172a43a                       # optional; defaults to odrbucket-<cr-name>
  managedClusters:
    - local-cluster                                       # a cluster may be in only ONE S3Configuration
status:
  type: Internal                                          # Internal | External
  phase: Ready                                            # Pending | Configuring | Ready | Failed
  message: S3 configured successfully
  configuredClusters:
    - local-cluster
```

External form (not exercised on this hub — no non-ODF pair available):

```yaml
spec:
  externalS3:
    secretRef:
      name: <secret>                 # must already exist on the hub
      namespace: openshift-operators
  managedClusters: [cluster1]
```

The referenced secret must carry **all five** keys or reconciliation fails:
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `s3Bucket`, `s3CompatibleEndpoint`, `s3Region`.

**Status gotchas for UI code:**

- There are **no `status.conditions`** — only `type`, `phase`, `message`, `configuredClusters`.
- Several failure paths set `phase: Failed` **without** updating `message`
  (`validateSecret`, `ensureRamenSecret`, `addS3ProfileToRamenConfig`, `ensureDrClusters`), so the
  UI must not assume `message` explains a failure.
- Cluster uniqueness is enforced **controller-side only** (no webhook); a conflict surfaces only as
  `phase: Failed`, which is why the console pre-checks it.
- Bucket/endpoint/region are **not** written back to status. To display them you must read the
  secret or the Ramen ConfigMap.

### 2.2 `MirrorPeer` (changed)

Cluster-scoped. Before and after on the same object:

```yaml
# 5.0, as stored
spec:
  items:
    - {clusterName: local-cluster, storageClusterRef: {name: ocs-storagecluster}}
    - {clusterName: dr1-nov-10-26, storageClusterRef: {name: ocs-storagecluster}}
  manageS3: true
  type: async

# after 5.1 CRDs + migration
spec:
  items: [ ...unchanged... ]
  manageS3: false          # cleared by the migration (one-shot marker)
  storageVendor: odf       # new field
  type: async
status:
  phase: Ready
```

`storageVendor` is `enum: [odf]`, `default: odf`, immutable (`self == oldSelf`). Only `odf` is
expressible today — Fusion Access is not.

Vestigial: `S3ConfigurationInProgress`, `S3ConfigurationFailed`, `MessageS3ConfigurationInProgress`,
`ReasonS3Configuring*` constants still exist in `mirrorpeer_types.go` but are referenced by no
non-test code. **Do not build UI on MirrorPeer S3 phases.**

### 2.3 `DRCluster` (ownership changed)

One per managed cluster, named after the cluster, cluster-scoped. Ownership moved from MirrorPeer to
S3Configuration:

```yaml
# before: ownerReferences: [{kind: MirrorPeer, name: mirrorpeer-sample}]
# after:
metadata:
  name: local-cluster
  ownerReferences:
    - {kind: S3Configuration, name: s3profile-local-cluster-ocs-storagecluster}
spec:
  s3ProfileName: s3profile-local-cluster-ocs-storagecluster
```

### 2.4 `DRPolicy` (unchanged shape)

```yaml
spec:
  drClusters: [local-cluster, dr1-nov-10-26]
  schedulingInterval: 5m
  replicationClassSelector: {}
  volumeSnapshotClassSelector: {}
  volumeGroupSnapshotClassSelector: {}
```

### 2.5 Resources the S3Configuration controller owns

| Object | Name | Namespace |
| --- | --- | --- |
| `ClusterManagementAddOn` | `s3config` | cluster-scoped |
| `ManagedClusterAddOn` | `s3config` | `spec.internalS3.providerCluster` |
| `ManifestWork` | `s3config-<cr-name>-obc` | `spec.internalS3.providerCluster` |
| `ObjectBucketClaim` (spoke) | `obcName` or `odrbucket-<cr-name>` | `spec.internalS3.namespace` |
| Secret (addon → hub) | = OBC name | managed-cluster namespace on hub |
| Ramen credential Secret | = **CR name** | MCO namespace (`openshift-operators`) |
| `DRCluster` | = each `managedClusters` entry | cluster-scoped |
| ConfigMap edit | `ramen-hub-operator-config` → `s3StoreProfiles[]` | MCO namespace |

Also added by 5.1 but not used here: `SourceManifest`, `AppliedManifest`.

### 2.6 Ramen ConfigMap

`ramen-hub-operator-config`, key `ramen_manager_config.yaml`, list `s3StoreProfiles`:

```yaml
- s3ProfileName: s3profile-local-cluster-ocs-storagecluster   # == S3Configuration name
  s3Bucket: odrbucket-1dcd0172a43a
  s3Region: <region>
  s3CompatibleEndpoint: https://<route host>
  s3SecretRef: {name: s3profile-local-cluster-ocs-storagecluster}
```

---

## 3. Console change (PR #3375)

Deleted `packages/mco/utils/tps-payload-creator.ts` (261 lines) — the Ramen secret writer, the
ConfigMap read-modify-write, and DRCluster create/delete. Replaced by
`packages/mco/utils/s3-configuration-payload.ts`, which only builds and creates the CR.

| Area | Change |
| --- | --- |
| Model | `S3ConfigurationModel` in `packages/shared/src/models/odf-mco.ts` |
| Types | `S3ConfigurationKind` in `packages/mco/types/odf-mco.ts`; `MirrorPeerKind.spec` drops `manageS3`, gains `storageVendor` |
| Constants | `packages/mco/constants/s3-configuration.ts` (phases, S3 type, secret keys); `MirrorPeerStorageVendor` |
| Watch | `getS3ConfigurationResourceObj` in `packages/mco/hooks/mco-resources.ts` (`optional: true`) |
| Submit | `utils/k8s-utils.ts`: S3Configuration(s) → MirrorPeer → DRPolicy |
| Form | `s3-bucket-details-form.tsx` loses the "S3 profile name" field and its validation |
| Review | bucket/endpoint instead of profile names |
| Progress | new `cluster-pairing-progress/s3-configuration-progress.tsx` waits on `phase: Ready` |
| Deletion | `drpolicy-list-page.tsx` deletes S3Configurations; **new `cleanupAfterDelete` hook** on the shared `DeleteModal` |

**Topology rule** (follows MCO, not the design doc examples): Async/RDR → one S3Configuration per
cluster; Sync/MDR → one shared across the pair.

### Two non-obvious details

- **The external secret is named `<cr-name>-credentials`, deliberately not `<cr-name>`.** MCO
  creates its own two-key Ramen secret under the CR's name in the same namespace; reusing that name
  would let MCO clobber the bucket/endpoint/region keys it needs to read back.
- **`cleanupAfterDelete` was necessary.** The existing `cleanupBeforeDelete` hook runs before the
  DRPolicy is deleted, and the S3Configuration controller refuses deletion while any DRPolicy
  references its `managedClusters`. Order must be policy-first.

### Console bugs found during live testing (both fixed)

1. **`clientInfo` is not a provider/client-mode signal.** Data Foundation publishes a local
   StorageClient even for a plain internal deployment, so `odf-info.clients` is non-empty on
   virtually every cluster and `getManagedClusterInfoTypes` sets `clientInfo`. The original guard
   therefore aborted DRPolicy creation on ordinary internal ODF. Only the "could a namespace be
   derived" check remains. Regression test built from the real cluster's shape.
2. **Thrown errors rendered as `{}`.** `JSON.stringify` on an `Error` yields `{}` because `message`
   and `stack` are non-enumerable, and `t()` imported bare from `i18next` returns empty in a
   non-React module, so the first failure showed the user nothing at all. `getThrownMessage` now
   prefers `error.message`, then k8s `json.message`, then `response.data.message`.

Unit tests missed both: the fixture encoded the assumption rather than the cluster's real data.

### Review feedback addressed (CodeRabbit)

- **Validation was all-or-nothing.** When only one cluster already had an `S3Configuration`, its
  read-only empty fields still failed validation and Next stayed disabled. Validation now works per
  cluster and skips covered ones.
- **Delete left the hub secret behind**, so the next create failed with `AlreadyExists`. Cleanup now
  removes it too, but only when the name matches the one the wizard generates, so a user-supplied
  secret is never touched.
- **Prettier failures.** Worth recording why these slipped through: `yarn format` maps to
  `yarn prettier -w .`, which hits the same missing-binary problem as `yarn lint`, `yarn build-mco`
  and the non-existent `yarn typecheck`. Every `yarn format` run silently did nothing. Use
  `npx prettier --write <files>` on this machine.

### Known coverage gap

The third-party / `externalS3` path is covered by unit tests only. Both test clusters run ODF, so
the wizard always takes the Data Foundation branch and the backend selector never appears.
Exercising it needs a pair without ODF.

---

## 4. MCO bugs found (not filed)

### Bug 1 — the 5.0 to 5.1 S3 migration is unreachable

`internal/controller/mirrorpeer/mirrorpeer_controller.go` gated the migration on
`spec.storageVendor == ""`. The CRD declares `default: odf`, and **Kubernetes applies CRD defaults
when reading from etcd**, not only on write. A MirrorPeer stored before the field existed therefore
reads back as `odf` the instant the new CRD is applied, so the guard never fires.

Proven on the hub: applying the 5.1 CRD alone — no operator involved — flipped the stored object
from no field to `storageVendor: odf`. With the unpatched 5.1 operator running: **zero**
S3Configurations, DRClusters still owned by MirrorPeer, and not one migration log line.

No manual escape either: `storageVendor` is `enum: [odf]` with `self == oldSelf`, so an admin cannot
clear it to re-trigger.

**Impact:** a silent no-op upgrade — looks successful, migrates nothing.
**Jira:** [RHSTOR-9690](https://issues.redhat.com/browse/RHSTOR-9690) is marked Closed; should be reopened.

**Fix applied:** gate on `spec.manageS3` (the durable legacy marker, read nowhere else), clear it
after migrating so it is one-shot. Extracted as `needsS3Migration()` to make it testable.

### Bug 2 — addon ClusterRole uses the singular resource name

`addons/s3config/setup.go:171` declared the hub ClusterRole over resource `"s3configuration"`.
RBAC matches resource names literally, so it grants nothing — and because the operator's own role
holds the plural, escalation prevention **refuses to create the role at all**:

```
"addon-registration-controller" failed to sync "local-cluster/s3config", err:
clusterroles "open-cluster-management:s3config:agent" is forbidden: ... attempt to grant extra privileges
  {APIGroups:["multicluster.odf.openshift.io"], Resources:["s3configuration"], ...}
```

Addon registration never completes → the OBC secret is never synced → every internal-S3
`S3Configuration` hangs in `Configuring` forever. **This affects fresh 5.1 installs too**, since the
shipped bundle grants only the plural.

**Fix applied:** `s3configurations`.

### Bug 3 (minor) — ownership is stripped before it is transferred

The migration removes the MirrorPeer ownerRef from DRClusters as its last step, immediately after
creating the S3Configuration CRs, without waiting for them to reconcile. The S3Configuration only
adopts the DRCluster later in `ensureDrClusters`. Observed window on the hub: `dr1-nov-10-26`'s
DRCluster was **ownerless** while its S3Configuration sat in `Configuring`.

It self-corrected once the S3Configuration reached `Ready`, so this is a transient window, not a
leak — but a permanently stalled S3Configuration would leave orphaned DRClusters that its own
deletion would no longer clean up. Suggest transferring ownership rather than stripping it.

### MCO working tree (uncommitted, in `~/Dev/odf-multicluster-orchestrator`)

```
 M addons/s3config/setup.go                                    (+8 -1)
 M internal/controller/mirrorpeer/mirrorpeer_controller.go     (+28 -2)
?? internal/controller/mirrorpeer/mirrorpeer_migration_test.go (new; package had no tests)
```

7 tests pass. `TestNeedsS3Migration/legacy_peer_whose_vendor_was_defaulted_by_the_CRD` is the
regression guard — it fails against the original logic.

---

## 5. Upgrade test

### Method (and its limits)

Built MCO from source and replaced the image in the CSV — the team's normal approach. Applied the
four 5.1 CRDs, the 5.1 ClusterRole, and `ADDON_IMAGE`.

**This does not test OLM upgrade mechanics** — no bundle, no catalog source, no CSV replacement or
RBAC rollout. Two problems hit along the way were artifacts of that method, not product defects:

- `image not provided for agent` — 5.1 renamed the env var `TOKEN_EXCHANGE_IMAGE` → `ADDON_IMAGE`.
- Operator crash-loop on startup — the 5.0 CSV's ClusterRole grants nothing on `s3configurations`,
  so the informer failed to sync and the manager exited.

A faithful upgrade test still needs a 5.1 bundle + catalog source.

### Result

Unpatched: silent no-op. Patched: clean, non-destructive, idempotent.

```
S3Configuration                              TYPE       PHASE   CONFIGURED
s3profile-local-cluster-ocs-storagecluster   Internal   Ready   [local-cluster]
s3profile-dr1-nov-10-26-ocs-storagecluster   Internal   Ready   [dr1-nov-10-26]

DRCluster        OWNER
local-cluster    S3Configuration
dr1-nov-10-26    S3Configuration

MirrorPeer  vendor=odf  manageS3=false  Ready
DRPolicy    odr-policy-5m  Validated=True
DRPCs       Deployed / FailedOver / FailedOver  (untouched)
```

It **adopted** rather than reprovisioned: both profiles still pointed at the original bucket
`odrbucket-1dcd0172a43a` (`Bound`, 6h old at the time), and the legacy secret was untouched.

---

## 6. UI test results

Console plugin built from the branch and swapped into the CSV (`deployments[1]`). Verified live by
grepping the served bundle for new strings and confirming `"S3 profile name"` was absent.

| Test | Result | Evidence |
| --- | --- | --- |
| DRPolicy list renders with new watch | pass | `01-drpolicy-list/` |
| Configure step shows **no S3 fields** on DF path | pass | `02-create-wizard/02-*` |
| Review omits "Replication site", shows `Data Foundation` | pass | `02-create-wizard/04-*` |
| Create **reuses** existing S3Configurations | pass | identical `09:33:19Z` timestamps |
| MirrorPeer reused, `manageS3` not set | pass | 1 MirrorPeer, unchanged |
| Delete with refcount > 1 leaves S3 alone | pass | `04-deletion/` |
| Delete last policy cascades fully | pass | all counts to 0, no errors |
| **Create fresh S3Configurations from scratch** | pass | see below |

Final cascade after deleting the last DRPolicy:

```
s3configuration: 0   drcluster: 0   drpolicy: 0   obc: 0
secrets: 0           s3StoreProfiles: 0           s3config addons: 0
controller errors during teardown: 0
```

The **MirrorPeer survived** (`manageS3=false`, `Ready`) — S3 lifecycle is now decoupled from storage
peering, which was the point of RHSTOR-9688.

### Fresh creation (the path reuse testing could not cover)

Run after the full teardown left the hub with zero S3 resources. Provenance is unambiguous: the
migration names CRs `s3profile-*` and annotates them `migrated-from-mirrorpeer`; these are
`s3-<cluster>` with no annotation, i.e. authored by the wizard.

```
NAME               TYPE       PHASE   CLUSTERS          PROVIDER        NAMESPACE           STORAGECLASS
s3-local-cluster   Internal   Ready   [local-cluster]   local-cluster   openshift-storage   openshift-storage.noobaa.io
s3-dr1-nov-10-26   Internal   Ready   [dr1-nov-10-26]   dr1-nov-10-26   openshift-storage   openshift-storage.noobaa.io

OBC         odrbucket-s3-local-cluster  Bound (freshly provisioned)
profiles    s3-local-cluster  -> odrbucket-s3-local-cluster  @ s3-openshift-storage.apps.dr2-...
            s3-dr1-nov-10-26  -> odrbucket-s3-dr1-nov-10-26  @ s3-openshift-storage.apps.dr1-...
secrets     s3-local-cluster, s3-dr1-nov-10-26   (named after the CRs)
DRClusters  both owned by S3Configuration        addons: s3config on both spokes
DRPolicy    Validated=True                       MirrorPeer reused, manageS3=false
controller errors: 0
```

Two S3Configurations for an Async policy confirms the per-cluster topology rule, and the endpoints
differ per site (`apps.dr2-...` vs `apps.dr1-...`), so the buckets are genuinely independent.

Screenshots: `ui-test-screenshots/` (gitignored), 9 files across four directories. Still missing a
shot of step 1 with clusters selected, and of the empty policy list after teardown.

### Environment notes

- Headful Chrome under WSLg wedges the renderer on the wizard route — **for the shipped plugin too**,
  so not a regression. Headless works; `.mcp.json` now passes `--headless --isolated`.
- In headless the wizard's cluster table showed 0 clusters for **both** plugin builds, despite both
  ManagedClusters being Joined/Available. Unrelated to this PR; the same page populated correctly in
  Edge. Worth a separate look.

---

## 7. Test hub state

DR is **fully torn down** — that was the agreed final test. No DRPolicy, DRClusters,
S3Configurations, OBC or protected applications. The MirrorPeer remains.

Still deployed:

- MCO operator: `quay.io/vbnrh/odf-multicluster-orchestrator:5.1-s3fix` (both fixes)
- `ADDON_IMAGE`: same ref
- Console plugin: `image-registry.openshift-image-registry.svc:5000/mco-build-51/odf-mco-console-51:latest`
- 5.1 CRDs: `s3configurations`, `sourcemanifests`, `appliedmanifests`, updated `mirrorpeers`

Added beyond the original cluster state (cleanup list):

```
clusterrole        odfmo-51-test-manager-role
clusterrolebinding odfmo-51-test
namespace          mco-build-51              (BuildConfigs + ImageStreams)
rolebindings       system:image-puller for openshift-operators and openshift-storage SA groups in mco-build-51
csv patches        deployments[0].image, deployments[0].env ADDON_IMAGE, deployments[1].image
```

Backups: `/tmp/mco-upgrade-backup/` (original CSV, CRD, MirrorPeer, DRClusters, DRPolicies, Ramen
ConfigMap, `ORIGINAL_IMAGE.txt`) and `/tmp/ui-test-baseline/` (pre-UI-test CR snapshots).

Restore the shipped operator image with:

```
oc patch csv odf-multicluster-orchestrator.v5.0.0-53.stable -n openshift-operators --type=json \
  -p '[{"op":"replace","path":"/spec/install/spec/deployments/0/spec/template/spec/containers/0/image","value":"'"$(cat /tmp/mco-upgrade-backup/ORIGINAL_IMAGE.txt)"'"}]'
```

---

## 8. Open items

1. Decide where the three MCO findings belong, then file them. They are defects in unreleased
   feature work, so DFBUGS is wrong: that tracker is for defects against shipped builds and carries
   Release Blocker / PM Approval / Doc Text triage that does not apply, besides inflating the
   release's bug count. They most likely belong as sub-tasks under RHSTOR-8997, alongside
   RHSTOR-9730 to RHSTOR-9733. All three are written up in section 4 and summarised in a comment on
   RHSTOR-9690, which also asks for that story to be reopened.
   (I filed them as DFBUGS-12640/12641/12642 by mistake and closed them as Not a Bug.)
2. Open an MCO PR with the two fixes + the new test file.
3. **Upstream ask:** make `internalS3` optional and default it from `odf-client-info`. The console
   currently rejects ODF provider/client mode because `internalS3.providerCluster` must be one of
   `managedClusters`, but in client mode the bucket lives on the provider, which need not be in the
   pair. MCO already resolves this in `ODFVendor.GetConfig`; the S3Configuration controller just
   never consults it.
4. Test the `externalS3` path on a non-ODF pair.
5. Test **fresh** DR creation through the wizard (only reuse was exercised, because the hub already
   had a migrated setup).
6. Attach screenshots to PR #3375 and tag `packages/mco/OWNERS`.
7. Pre-existing, unrelated to this PR: `packages/odf/.../UploadStatusList.tsx` has a broken
   `AutoSizer` import that fails `tsc` and `build-mco` locally; `create-dr-policy.spec.tsx` remains
   `describe.skip`'d pending a PatternFly 6 selector pass; `yarn lint`/`lint-css`/`build-mco` fail at
   `yarn <binary>` resolution.
