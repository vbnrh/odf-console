# RHSTOR-9511: DRPolicy creation with multiple storage providers — console design

**Epic:** UI: DRPolicy Creation When Multiple Storages (e.g. FA and ODF) Are Configured
**Supersedes:** the verdict, blocker table, inferred architecture and most open questions in
[rhstor-9511-feasibility.md](./rhstor-9511-feasibility.md). That document was written against an
older MCO; several of its blockers no longer exist. See [§8](#8-corrections-to-the-feasibility-check).

This note records what the backend actually provides, the product rules we have been given, and the
console abstraction that lets per-vendor rules be declared rather than branched on.

---

## 1. Scope

Three storage providers, decided with PM:

| Provider                 | Identity                 | Status                     |
| ------------------------ | ------------------------ | -------------------------- |
| Data Foundation (DF)     | ODF / Ceph               | Supported today            |
| IBM Storage Scale (CNSA) | `scale.spectrum.ibm.com` | New in this epic           |
| Generic third-party      | no vendor identity       | Supported today, unchanged |

**Explicitly out:** IBM FlashSystem and SAN. They appear in the UX mockups as reference only. The
SAN-specific "Replication configuration" step (user-declared Sync/Async) is dropped with them; no
supported provider needs it.

Also deferred: the mockups' "S3 data source" step offering Internal vs External per provider. For
now DF is internal-only and CNSA is external-only (same as generic). PM is deciding whether both
options open up; the abstraction below keeps the slot.

---

## 2. What the backend provides

Read from `odf-multicluster-orchestrator` at commit `b5f0a70`. This is the load-bearing section —
the feasibility check guessed at most of it and guessed wrong.

### 2.1 Detection: one hub ConfigMap per vendor, shared key convention

MCO's managed-cluster controller is no longer gated on ODF. It walks a set of vendor ClusterClaims
(`pkg/utils/managedcluster.go:16-23`):

| ClusterClaim               | Value                                                   | Hub ConfigMap            |
| -------------------------- | ------------------------------------------------------- | ------------------------ |
| `odfinfo.odf.openshift.io` | `openshift-storage/odf-info`                            | `odf-client-info`        |
| `scale.spectrum.ibm.com`   | `ibm-spectrum-scale/ibm-spectrum-scale-replicationinfo` | `ibm-storage-scale-info` |

Each claim gets its own ManagedClusterView prefix (`odf-multicluster-mcv-`,
`scale-multicluster-mcv-`; `pkg/utils/managedclusterview.go:15-16`), and the MCV controller projects
each into a ConfigMap in MCO's own namespace. Both are keyed identically, by
`utils.GetKey(managedClusterName, <vendorClusterName>)` (`pkg/utils/hash.go:24`, written at
`managedclusterview_controller.go:238,257,289`).

A managed cluster may advertise both claims — there is an explicit `"Both ODF and IBM Storage Scale"`
test case in `pkg/utils/managedcluster_test.go`.

**Consequence for the console:** the provider signal is "which hub ConfigMaps contain a key for this
managed cluster". No per-cluster MCV round-trips, no provider discriminator to invent. The Scale
payload is small (`pkg/storagevendor/ibmstoragescale/types.go`):

```go
type IbmStorageScaleInfo struct {
    Version           string   `json:"version"`
    OperatorNamespace string   `json:"operatorNamespace"`
    Cluster           Cluster  `json:"cluster"`          // .Name joins via GetKey
    SourceManifests   []string `json:"sourceManifests"`
}
```

### 2.2 MirrorPeer is already vendor-aware

`api/v1alpha1/mirrorpeer_types.go`:

- `MirrorPeerSpec.StorageVendor VendorType`, `+kubebuilder:default=odf`, CEL-immutable.
- Enum is currently `+kubebuilder:validation:Enum=odf;` — the trailing `;` is the slot for `scale`.
- `PeerRef` is unchanged structurally, but `StorageClusterRef.Namespace` is now **optional**. For
  Scale, `storageClusterRef.name` is the Scale cluster name, which is what joins back into
  `ibm-storage-scale-info`.
- The ODF version check moved behind `StorageVendor.ValidateVersion`
  (`pkg/storagevendor/interface.go:28-37`), so it no longer applies to non-ODF vendors.

So CNSA genuinely pairs. Its DR mechanism is **manifest sync**, not mirroring: the vendor declares
`SourceManifest`s on the source cluster, MCO transports them, the vendor applies `AppliedManifest` on
the peer and reports health, which MCO reflects on the MirrorPeer status
(`design/manifest-sync.md`). All of it runs inside the MirrorPeer reconcile via
`ConfigureStorageForDR` / `CleanupResources`.

**What is missing:** `factory.New` returns `unsupported storage vendor` for anything but ODF
(`pkg/storagevendor/factory.go:32-39`), and `pkg/storagevendor/ibmstoragescale/` contains only
`types.go` and `configmap.go` — no `vendor.go` implementing the interface. That is the PR the CNSA
team owes, along with their enum value.

### 2.3 S3Configuration

`internalS3` is **not** ODF-specific. MCO commit `14bc197` reworded `S3Type`: internal S3 is
"provisioned via an OBC against a StorageClass, which can be backed by ODF or any other vendor that
provides one". The OBC is created on `internalS3.providerCluster`.

Both `internalS3` and `externalS3` are mutually exclusive, immutable after creation, and cannot be
converted into one another (CEL rules, `api/v1alpha1/s3configuration_types.go:102-106`).

So the console's current internal↔DF coupling is ours, not a backend constraint. Keeping it for now
is a product decision, not a technical one.

### 2.4 MirrorPeer status already reports S3 progress

`MirrorPeerPhaseMessage` includes `S3ConfigurationInProgress`, `S3ConfigurationFailed`,
`DRClusterConfigurationInProgress`, `DRClusterConfigurationFailed`. The console already models these
(`packages/mco/constants/mirrorpeer.ts`).

This makes the mockups' single "Cluster pairing in progress" screen achievable: the branch's separate
`S3ConfigurationProgress` can fold back into `ClusterPairingProgress`, driven off MirrorPeer status,
for any vendor that creates a MirrorPeer.

---

## 3. Product rules

### 3.1 Per-provider behaviour

|                            | DF                                            | CNSA                                  | Generic                                       |
| -------------------------- | --------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| Creates MirrorPeer         | yes (`odf`)                                   | yes (enum TBD)                        | **no**                                        |
| Replication type           | derived from `cephFSID`                       | **Sync, fixed**                       | Async                                         |
| Scheduling interval        | variable                                      | **`0m`, fixed**                       | variable                                      |
| Multiple policies per pair | yes                                           | **no**                                | yes                                           |
| S3                         | internal only                                 | external only                         | external only                                 |
| Pre-pair checks            | StorageClass compatibility + Submariner       | **TBD**                               | none                                          |
| Policy name                | user-entered                                  | generated                             | user-entered                                  |
| Wizard steps               | Clusters, Provider, Configure, Policy, Review | Clusters, Provider, Configure, Review | Clusters, Provider, Configure, Policy, Review |

The invariant behind "multiple policies per pair": a provider can carry more than one policy on a
pair iff its scheduling interval can differ between them. CNSA is pinned at `0m` Sync, so a second
policy would be identical to the first.

CNSA's Sync + `0m` needs **no payload change** — `k8s-utils.ts:121-122` already writes `'0m'` for any
non-Async type. Only the derivation changes, which today keys off `cephFSID`
(`select-replication-type.tsx:54-73`) and would otherwise send CNSA down the Async branch. This is
DFBUGS-8864.

### 3.2 Provider availability

A provider is offered for a selected cluster pair when:

```
(detected on BOTH clusters)  ∪  {generic}
```

Generic is **always** offered. It has no hub signal by definition — the user configured replication
on their own storage. An empty detection intersection therefore means "generic only", which is the
normal third-party flow, not an error state.

This diverges from the mockup annotation _"Next will not be enabled until the Storage providers are
the same in both the clusters"_. There is no such block: mismatched providers simply narrow the
provider step to generic.

### 3.3 Pairing ownership

A cluster pair is **paired** once any provider has set it up for RDR or MDR. The pairing provider
becomes the pair's owner, and ownership is exclusive:

| Owner   | Offered on day 2               |
| ------- | ------------------------------ |
| DF      | DF only                        |
| CNSA    | nothing — pair is closed       |
| Generic | generic only                   |
| none    | all available providers (§3.2) |

Only one provider per pair, for now. Within the owning provider, §3.1's "multiple policies" rule
applies — so a DF-owned pair can take further DF policies, and a CNSA-owned pair cannot take
anything.

**Ownership is live state, not permanent.** When the user removes the MirrorPeer and every policy
backing it, the pair is free to be configured for any provider again.

Resolving the owner:

- DF and CNSA — read `spec.storageVendor` off the MirrorPeer covering the pair.
- Generic — creates no MirrorPeer, so it must be derived: a DRPolicy whose two DRClusters are the
  selected pair, with no MirrorPeer covering that pair. S3Configuration presence cannot discriminate,
  because DF creates one too.

### 3.4 Teardown

Deleting a DRPolicy today runs `cleanupAfterDelete: cleanupS3Configurations`
(`drpolicy-list-page.tsx:137`), which reference-counts S3Configurations through
`drClusterToPoliciesMap` and deletes only when the last policy using a cluster goes. DRClusters are
GC'd by the S3Configuration controller behind that.

**The MirrorPeer is not in that hook, and never has been — on either side.** This is a gap, not a
regression:

- Console: the only `deleteMirrorPeerByName` call is `cluster-pairing-progress.tsx:220`, the rollback
  when a user cancels pairing mid-flight.
- MCO: nothing initiates a MirrorPeer deletion. `rg` finds no `Delete(ctx, mirrorPeer)` in the repo,
  and the DRPolicy controller only _reads_ MirrorPeers (`getMirrorPeerForClusterSet`) to build
  VRC/VGRC ManifestWorks.

MirrorPeer _was_ referenced in the console's delete path until recently, which is easy to misremember
as deletion. Commit `a54c1a95` used it as an **exclusion filter** — `getUnpairedDRClusters`, whose
comment reads _"If its part of MirrorPeer, then its managed by ODF itself and hence it will be
responsible for cleanup"_ — so the console deleted only the self-managed third-party DRClusters.
Commit `17f767c0` removed that deliberately and correctly: `manageS3` is deprecated and
S3Configuration now owns the DRClusters.

So a DF or CNSA pair keeps its MirrorPeer after its last policy is deleted. Harmless today, because
nothing reads it as a lock — but §3.3 makes it load-bearing, and the pair would never free up.

**Fix:** extend the same reference-counting hook to delete the MirrorPeer covering the pair when its
policy count reaches zero, reinstating the MirrorPeer watch there (copy
`create-dr-policy-wizard.tsx:96-101`). This applies to **DF and CNSA alike** — both create
MirrorPeers — so it changes existing DF deletion behaviour, not just new CNSA behaviour.

We only have to _initiate_ the delete. MCO's MirrorPeer controller holds a finalizer
(`hub.multicluster.odf.openshift.io`) and, on `DeletionTimestamp`, runs
`vendor.CleanupResources(ctx, mirrorPeer)` and strips its owner reference from the DRCluster
(`mirrorpeer_controller.go:236`). The vendor-specific half of the teardown is CNSA's
`CleanupResources` implementation, not ours.

The residual risk is therefore not ordering on our side — MCO's finalizer holds the object until its
cleanup completes — but the S3Configuration and MirrorPeer teardowns racing on the same DRCluster.
That is a question for MCO (§7 item 6), not a constraint on this design.

---

## 4. The abstraction

Mirrors MCO's own `pkg/storagevendor` split: a registry of descriptors, declarative where the
variation is data, with functions only where payloads are genuinely vendor-shaped.

```ts
type StorageVendorDescriptor = {
  id: StorageVendorId;
  /** MCO's spec.storageVendor literal. undefined ⇒ this vendor creates no MirrorPeer. */
  mirrorPeerVendor?: MirrorPeerStorageVendor;
  label: string;
  description: string;

  // ---- detection -------------------------------------------------------
  /** Hub ConfigMap in MCO's namespace, or undefined for always-available vendors. */
  hubConfigMap?: string;
  parseClusterInfo?: (raw: string) => VendorClusterInfo;
  /** Offered even with no hub signal (generic). */
  alwaysAvailable?: boolean;

  // ---- replication -----------------------------------------------------
  replication:
    | { mode: 'derived' } // DF
    | { mode: 'fixed'; type: ReplicationType; interval: string } // CNSA: Sync, '0m'
    | { mode: 'async'; intervalEditable: true }; // generic

  allowsMultiplePoliciesPerPair: boolean;

  // ---- flow ------------------------------------------------------------
  s3: 'internal' | 'external' | 'both';
  steps: CreateDRPolicyWizardSteps[];
  policyName: 'user' | 'generated';
  prePairChecks: PrePairCheck[];

  // ---- payloads --------------------------------------------------------
  createPolicy(state: DRPolicyState): Promise<CreateDRPolicyResult>;
  cleanup(
    policy: DRPolicyKind,
    refCounts: DRClusterPolicyCounts
  ): Promise<void>;
};
```

`mirrorPeerVendor: undefined` carries the generic case structurally, instead of a
`BackendType.ThirdParty` branch repeated across the wizard, the payload builder and the cleanup path.

### 4.1 Pre-pair checks

Today the Clusters step blocks on `SelectedClusterValidation`, which bundles per-cluster checks,
existing-peering checks, and `useStorageClassValidation` — an async Search-API fetch of every
StorageClass on both clusters, collapsed by `findSupportedStorageClasses` into one boolean. Submariner
lives separately in `usePrePairNetworkValidation`, gated on `step !== Clusters` and DF-only.

The StorageClass check is **DF's check**, not a shared one. It moves next to Submariner, behind the
provider choice. Each vendor declares its own:

```ts
type PrePairCheck = {
  id: string;
  run(clusterNames: string[]): { status: string; canProceed: boolean };
  /** Advisory checks the user may override — e.g. Submariner NotInstalled / Unknown. */
  requiresAcknowledgement?(status: string): boolean;
  render(result: PrePairCheckResult): React.ReactNode;
};
```

- **DF** — `[storageClassCompatibility, submariner]`
- **CNSA** — `[]` for now. Checks are not confirmed; the slot stays open deliberately.
- **Generic** — `[]`. Configure is the S3 form, unchanged.

Three things this buys:

1. **The storage check becomes provider-scoped.** It cannot be today, because it runs before a
   provider is chosen — hence the Ceph ∪ IBM provisioner union in `use-storage-provisioner.ts:56` and
   the all-or-nothing answer. The question changes from "do these clusters share any supported
   StorageClass?" to "is _this_ provider replicable across both?".
2. **The Clusters step stops blocking on a Search-API round-trip.** It validates selection-shaped
   things only: two clusters, available, no conflicting existing peering.
3. **One gate on Configure**, combining every check the chosen provider declares.

Generalising `requiresAcknowledgement` now matters: it is currently hardcoded to Submariner statuses
(`requiresSubmarinerAcknowledgement`, plus `acknowledgedStatus` in the wizard). Lifting it into the
check interface means CNSA's eventual check can be advisory-with-override or hard-blocking without
touching the wizard.

### 4.2 Ownership resolver

One shared function, outside the registry, because it reasons across vendors:

```ts
resolvePairOwner(
  clusterPair: [string, string],
  mirrorPeers: MirrorPeerKind[],
  drPolicies: DRPolicyKind[],
  registry: StorageVendorDescriptor[],
): StorageVendorDescriptor | undefined
```

Evaluated on **cluster selection**, not provider selection, and read live so a torn-down pair
re-opens immediately (§3.3). Generic's missing MirrorPeer is a resolution strategy here rather than a
special case scattered through the UI.

### 4.3 What not to abstract

Submariner/Globalnet and the RBD image-flatten option are DF-only with no second instance to
generalise against. A descriptor flag plus a conditional render is honest; an interface is
speculation. Same for the Day-2 "Paired" label — it is a rendering of §3.3, not a vendor concern.

---

## 5. Where it plugs in

Every one of these is currently hardcoded to the two-value `BackendType`:

| Call site                               | Today                                                              | Becomes                                                 |
| --------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `select-cluster-list.tsx:306-321`       | `doClustersHaveODF ? DataFoundation : ThirdParty`                  | detection over descriptors                              |
| `configure-cluster-pair-step.tsx:68-73` | `showBackendSelection` gate hiding the chooser when ODF is present | deleted; the provider step always renders               |
| new provider step                       | —                                                                  | registry filtered by §3.2 availability ∩ §3.3 ownership |
| `create-dr-policy-wizard.tsx:302-358`   | four static `<WizardStep>` children                                | `descriptor.steps`                                      |
| `select-replication-type.tsx:54-73`     | `cephFSID` effect                                                  | `descriptor.replication`                                |
| `step-validation.ts:24-26`              | `shouldRunPrePairValidation` requires DF                           | per-descriptor `prePairChecks`                          |
| `selected-cluster-validator.tsx`        | `useStorageClassValidation` gates the Clusters step                | moves into DF's pre-pair check                          |
| `k8s-utils.ts:193`                      | `if (replicationBackend === DataFoundation)`                       | `descriptor.createPolicy`                               |
| `k8s-utils.ts:97`                       | `storageVendor: MirrorPeerStorageVendor.ODF`                       | `descriptor.mirrorPeerVendor`                           |
| `drpolicy-list-page.tsx:137`            | `cleanupS3Configurations`                                          | `descriptor.cleanup`, + MirrorPeer (§3.4)               |
| `cluster-list-columns.tsx:28-31`        | a `Data Foundation` column                                         | multi-valued `Storage provider` column                  |

`BackendType` (`constants/disaster-recovery.ts:153-156`) and `MirrorPeerStorageVendor`
(`constants/mirrorpeer.ts:5-7`) collapse into the registry. The stale comment on the latter — "other
vendors are not expressible yet" — should go with it; they are expressible, the enum value just is
not declared.

---

## 6. Delivery order

1. **Detection migration** (RHSTOR-9614). Read `odf-client-info` and `ibm-storage-scale-info` from
   MCO's namespace; retire the MCV watch at `select-cluster-list.tsx:242-251`. Replace
   `isValidODFVersion` with per-vendor presence. Unblocks everything else and stands on its own
   merits.
2. **Registry + ownership resolver**, with DF and generic as the first two descriptors and behaviour
   held bit-for-bit identical. No user-visible change.
3. **Provider step**, rendering the registry. DF and generic only; CNSA appears once detection and
   the enum land.
4. **Pre-pair check move** — storage compatibility out of the Clusters step into DF's checks.
5. **MirrorPeer teardown** in `cleanupAfterDelete` (§3.4).
6. **CNSA descriptor** — Sync/`0m`, generated policy name, no Policy step, empty check list.
7. **Progress-screen consolidation** (§2.4), optional and independent.

Steps 1–5 need nothing from MCO. Only 6 waits on the CNSA PR.

---

## 7. Open items

| #   | Item                                                                                                                      | Owner      |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | CNSA's `spec.storageVendor` enum literal                                                                                  | CNSA / MCO |
| 2   | CNSA's `StorageVendor` implementation (`pkg/storagevendor/ibmstoragescale/vendor.go`)                                     | CNSA       |
| 3   | CNSA's pre-pair checks, if any                                                                                            | CNSA       |
| 4   | Whether Internal/External S3 opens up per provider (§1)                                                                   | PM         |
| 5   | Which cluster provides the OBC for internal S3 — MCO's design doc leaves this open, and the mockups ask the same question | MCO        |
| 6   | Whether S3Configuration and MirrorPeer teardown can race on the same DRCluster (§3.4)                                     | MCO        |

Nothing here blocks delivery steps 1–5.

---

## 8. Corrections to the feasibility check

[rhstor-9511-feasibility.md](./rhstor-9511-feasibility.md) was written against an older MCO. Four
things in it are wrong:

1. **"B1b: MCO does not yet aggregate a provider-agnostic surface."** It does — one ConfigMap per
   vendor sharing a key convention (§2.1). The document also asserted `odf-client-info` was "not the
   agnostic surface we can migrate onto"; it is half of it.
2. **"B1c: `MirrorPeer` cannot express a pairing over a non-ODF provider."** It can —
   `spec.storageVendor` exists, and the ODF version check moved behind the vendor interface (§2.2).
   The document called this "the largest single unknown in this epic"; it is a declared field
   awaiting one enum value.
3. **§3's inferred architecture.** It derived a multi-provider model from CR shapes because no design
   existed. MCO's `pkg/storagevendor` and `design/manifest-sync.md` are that design, and the inferred
   conclusion — "one policy per provider, pairings not independently manageable" — is superseded by
   §3.3's exclusive-ownership rule.
4. **Most of §5's open questions** (Q1–Q4, Q8–Q12, Q15, Q16) are answered by §2 and §3 here, or were
   closed by PM. §7 above is the live list.

What stands: §2's account of the console's own behaviour, the `useStorageProvisioners` two-bucket
shortcut (§2.2 there), the `cephFSID` replication-type bug, and the detection-regression risk.
