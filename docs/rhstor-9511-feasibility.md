# RHSTOR-9511: Feasibility check

**Epic:** UI: DRPolicy Creation When Multiple Storages (e.g. FA and ODF) Are Configured
**Assignee:** Vineet Badrinath · **Target:** ODF v5.1.0 (proposed) · **Status:** To Do

---

> ## ⚠ Partly superseded — read [rhstor-9511-design.md](./rhstor-9511-design.md) first
>
> This was written against an older `odf-multicluster-orchestrator`. Four things below are now
> wrong:
>
> - **B1b** — MCO _does_ aggregate a provider-agnostic surface: one hub ConfigMap per vendor
>   (`odf-client-info`, `ibm-storage-scale-info`) sharing a `GetKey(cluster, vendorCluster)` key.
> - **B1c** — `MirrorPeer` _can_ express a non-ODF pairing. `spec.storageVendor` exists and is
>   defaulted/immutable; the ODF version check moved behind `StorageVendor.ValidateVersion`. Only
>   CNSA's enum value and its `StorageVendor` implementation are outstanding.
> - **§3's inferred architecture** — derived from CR shapes because no design existed. MCO's
>   `pkg/storagevendor` and `design/manifest-sync.md` are that design. The exclusive-ownership rule
>   in the design note replaces "one policy per provider".
> - **Most of §5's open questions** (Q1–Q4, Q8–Q12, Q15, Q16) are answered or closed by PM.
>
> Still accurate: §2's account of the console's own behaviour, the `useStorageProvisioners`
> two-bucket shortcut, the `cephFSID` replication-type bug (DFBUGS-8864), and the
> detection-regression risk in §6.

---

## 1. Verdict

**Feasible on the console side, provided two things exist first:**

1. **CNSA capability is surfaced on the hub the same way ODF's is.** The console can only render what
   the hub tells it. Today the hub can say "this managed cluster has ODF"; it cannot say "this
   managed cluster has ODF _and_ Fusion Access". That takes two pieces, and neither exists yet: CNSA
   publishing its facts on the spoke, and MCO aggregating them into a hub-side surface that isn't
   ODF-shaped. Until both land, the console has no signal to branch on and the premise of the epic
   ("multiple storages are configured") is invisible to us.
2. **The UX and the multi-provider model are designed.** Not just the screens: the pairing model, what
   a DRPolicy is scoped to when a pair has two providers, and whether providers can be unpaired
   independently. These are cross-component decisions, not console-local ones.

With both in place this is not a new feature. The wizard already has a replication-backend
abstraction (`BackendType.DataFoundation` / `BackendType.ThirdParty`) with two fully separate
creation paths. The work is (a) removing a deliberate gate, (b) fixing storage-type detection, and
(c) fixing the scheduling interval for FA-MDR.

Blockers:

| #   | Blocker                                                                                                                                                                 | Owner                     | Tracker                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| B1a | CNSA does not yet publish the ClusterClaim / ConfigMap that MCO needs in order to report FA capability to the hub                                                       | CNSA (Rakesh)             | RHSTOR-9510                                                     |
| B1b | ~~MCO does not yet aggregate a provider-agnostic surface on the hub~~ **RESOLVED** — one hub ConfigMap per vendor, shared key convention                                | MCO                       | done                                                            |
| B1c | ~~MCO's `MirrorPeer` API cannot express a pairing over a non-ODF provider~~ **RESOLVED** — `spec.storageVendor` exists; CNSA owes its enum value + `StorageVendor` impl | MCO / CNSA                | partly open                                                     |
| B1d | Console still reads the legacy per-cluster `odf-info` MCV rather than the hub-side surface                                                                              | Console (us)              | RHSTOR-9614                                                     |
| B2  | No product decision or design on FA-RDR UX, the multi-provider pairing model, and independent unpairing                                                                 | PM (Brian) + design phase | [§5.4](#54-for-pm-brian-not-backend-but-gates-all-of-the-above) |

Without B1 in full the console cannot distinguish "ODF + FA" from "ODF only". Without B2 we cannot
scope items 4 to 6 below.

**On B1 ownership.** Detection belongs on the backend, and MCO is the right owner of the aggregation.
The aggregation itself is not agnostic yet, though, so this is not purely a CNSA-side wait. Reading
[odf-multicluster-orchestrator](https://github.com/red-hat-storage/odf-multicluster-orchestrator) as
it stands today:

- The ManagedCluster reconcile is gated on the `odfinfo.odf.openshift.io` ClusterClaim
  (`utils.HasRequiredODFKey`, `controllers/acm/managedcluster_controller.go`). A cluster running only
  Fusion Access never enters the pipeline at all, so it produces no hub-side entry.
- The `ManagedClusterView` it creates is scoped specifically to the managed cluster's `odf-info`
  ConfigMap (`hasODFInfoInScope`, `controllers/acm/managedclusterview_controller.go`).
- The result is unmarshalled into `ocsv1alpha1.OdfInfoData`, an OCS API type, and re-emitted as
  `odf-client-info` in MCO's namespace.
- The emitted shape is `ClientInfo` / `ProviderInfo` (`controllers/odf/clientinfo.go`), whose fields
  are `cephClusterFSID`, `infoCephBlockPools`, `storageProviderEndpoint`, `deploymentType`. There is
  no provider discriminator, and nothing in the repo references CNSA, Spectrum Scale, or Fusion
  Access.

So `odf-client-info` is not the agnostic surface, it is the hub-side projection of the ODF-only one.
Something has to produce an agnostic aggregate, whether that is a reshape of `odf-client-info` or a
new ConfigMap alongside it, and the entry point (ClusterClaim name and MCV scope) has to stop being
ODF-specific too. That is an MCO deliverable with no tracker that I can find, and it sits between
RHSTOR-9510 and RHSTOR-9614: CNSA publishing facts on the spoke does nothing for us until MCO
aggregates them, and our migration cannot target a shape that does not exist yet.

Correcting my earlier reading in this document: I had recorded that MCO's aggregation was already
provider-agnostic and that no MCO story was needed. The code does not support that.

**On B1c, the `MirrorPeer` API.** The aggregation is not the only ODF-shaped piece. `MirrorPeer` is
MCO's own CRD and it is written around ODF at the API level, not just internally
(`api/v1alpha1/mirrorpeer_types.go`):

- A peer is a `PeerRef{ clusterName, storageClusterRef{ name, namespace } }`. The only thing a peer
  can point at is an OCS `StorageCluster`. There is no provider field, so nothing in the spec can say
  "this pairing is over Fusion Access".
- `spec.items` is `MinItems=2, MaxItems=2` with `listMapKey=clusterName`, so one CR holds exactly one
  storage system per cluster. Two providers on the same pair cannot be expressed in one MirrorPeer.
- Both `clusterName` and `storageClusterRef.name` are pinned immutable by CEL rules, so a pairing
  cannot be retargeted at a different storage system after creation.
- Validation is explicitly ODF-aware: `isVersionCompatible` (`controllers/odf/validations.go`) looks
  up the peer in `odf-client-info` and requires the StorageCluster's ODF version to match MCO's own
  major.minor. A non-ODF provider has no such version, so it fails validation outright.
- Reconcile then drives ODF-specific machinery: `StorageClusterPeer` ManifestWorks, onboarding-token
  secrets, per-blockpool mirroring.

Two consequences worth calling out. First, `utils.GetKey(clusterName, storageClusterRef.Name)` is the
join key between `MirrorPeer` and `odf-client-info` throughout MCO, so B1b and B1c are one change,
not two: reshaping the ConfigMap without reshaping `MirrorPeer` breaks the join. Second, this is a
CRD-level change to a GA API, which means conversion or a new version rather than an in-place field
addition. That makes B1b plus B1c the largest single unknown in this epic, and neither has a tracker.

The console consequence is contained but real: we build `PeerRef` payloads directly from
`storageClusterInfo` in
[k8s-utils.ts:43-107](../packages/mco/components/create-dr-policy/utils/k8s-utils.ts#L43-L107), and
`fetchMirrorPeer` matches existing peerings on `clusterName` plus `storageClusterRef` name/namespace.
Whatever shape MCO lands, those two functions change with it.

**Independently deliverable today:** the FA-MDR scheduling-interval bug (DFBUGS-8864), gated on a
storage-type signal that is at least good enough to say "this pair is FA".

---

## 2. What the code does today

### 2.1 Backend is auto-derived, never user-chosen when ODF is present

[select-cluster-list.tsx:306-321](../packages/mco/components/create-dr-policy/wizard-steps/clusters-step/select-cluster-list.tsx#L306-L321):

```ts
const doClustersHaveODF = selectedClusterList?.every(
  (cluster) => cluster?.odfInfo?.isValidODFVersion
);
dispatch({
  type: SET_REPLICATION_BACKEND,
  payload: doClustersHaveODF
    ? BackendType.DataFoundation
    : BackendType.ThirdParty,
});
```

and [configure-cluster-pair-step.tsx:68-73](../packages/mco/components/create-dr-policy/wizard-steps/configure-cluster-pair-step/configure-cluster-pair-step.tsx#L68-L73):

```ts
const showBackendSelection =
  !selectedClustersHaveODF && selectedClusters.length > 0 && ...
```

This is the exact behaviour the epic calls out. It was intentional: commit `ebf342df`
_"Block selection of replication backend if ODF present"_. Undoing it is a one-condition change; the
hard part is deciding what replaces it.

### 2.2 We collapse every supported provisioner into one "Data Foundation" bucket

This one is ours, and it was a deliberate simplification rather than an oversight. The cluster table
only ever needed two categories, supported and third-party, so
[use-storage-provisioner.ts:56-72](../packages/mco/hooks/use-storage-provisioner.ts#L56-L72) unions
`CEPH_PROVISIONERS` and `IBM_PROVISIONERS` into `supportedProvisioners`, counts anything in that set
as one number, and shows everything else by raw provisioner name. Folding the IBM provisioners into
the supported set was correct; what never got generalised is the display label, which is still
hard-coded to `'Data Foundation'` (the variable is literally called `odfCount`):

```ts
const supportedProvisioners = [...CEPH_PROVISIONERS, ...IBM_PROVISIONERS];
...
if (odfCount > 0) provs.push({ displayName: 'Data Foundation', count: odfCount });
```

`IBM_PROVISIONERS` is `['spectrumscale.csi.ibm.com', 'fusionaccess.storage.ibm.com/csi']`
([storageClasses.ts:11-14](../packages/shared/src/constants/storageClasses.ts#L11-L14)), so a
CNSA-only cluster reports "Data Foundation" in the _Storage provisioners_ column and an ODF+FA
cluster reports a single merged count.

That was fine while "supported" and "ODF" meant the same thing. This epic is the point where they
stop meaning the same thing, so the two-bucket model has to become per-provider. Cheap to fix and
worth doing regardless.

Two things it is not, though. It is not a detection mechanism: a provisioner string says a
StorageClass exists, not that the backend is DR-capable, which is exactly why RHSTOR-9510 asks CNSA
for a ClusterClaim and ConfigMap. And it is not on the critical path for this epic, since the real
signal arrives via [§2.6](#26-the-detection-surface-we-read-is-the-legacy-odf-shaped-one). Treat it
as paying back our own shortcut, not as a prerequisite.

### 2.3 Sync/Async is decided purely from `cephFSID`, an ODF-only field

[select-replication-type.tsx:54-73](../packages/mco/components/create-dr-policy/wizard-steps/policy-step/select-replication-type.tsx#L54-L73):

```ts
const isThirdPartyPath = !cephFSID1 && !cephFSID2;
payload: isThirdPartyPath
  ? ReplicationType.ASYNC
  : cephFSID1 === cephFSID2
    ? ReplicationType.SYNC
    : ReplicationType.ASYNC;
```

Consequence for FA (DFBUGS-8864): FA has no `cephFSID`, so the wizard always picks **Async**, and
[k8s-utils.ts:122-123](../packages/mco/components/create-dr-policy/utils/k8s-utils.ts#L122-L123)
then writes `schedulingInterval = syncIntervalTime` (default `5m`) instead of `0m`:

```ts
const schedulingInterval =
  replicationType === ReplicationType.ASYNC ? syncIntervalTime : '0m';
```

The dropdown is `isDisabled`, so the user cannot correct it, and the _Replication interval_ input is
rendered for every Async policy regardless of backend.

Worth noting: the **status/monitoring** side already understands `0m`
([dr-status.ts:241-243](../packages/mco/utils/dr-status.ts#L241-L243),
[disaster-recovery.tsx:276-278](../packages/mco/utils/disaster-recovery.tsx#L276-L278); both
explicitly name FusionAccess). Only the creation path can't produce it.

### 2.4 We already read Ramen's `storageid`, then throw the detail away

[selected-cluster-validator.tsx:291-347](../packages/mco/components/create-dr-policy/wizard-steps/clusters-step/selected-cluster-validator.tsx#L291-L347)
builds a `Map<clusterName, string[]>` of StorageClasses that (a) have a Ceph **or** IBM provisioner
and (b) carry the `ramendr.openshift.io/storageid` label
([constants:151](../packages/mco/constants/disaster-recovery.ts#L151)). It then collapses that map
into a single boolean via `findSupportedStorageClasses`: "do the two clusters share at least one
`name/provisioner` string?"

Two things follow:

- The console **already has** the raw material to enumerate "which storage systems are common to both
  clusters". Per-provider awareness is a matter of not discarding it, not of new plumbing.
- The pairing check matches on `name/provisioner`, **not** on `storageid`. Whether that is correct
  for a multi-provider pair is a Ramen question (see §5, Q1 and Q2).

### 2.5 Creation paths are already forked

[k8s-utils.ts:185-267](../packages/mco/components/create-dr-policy/utils/k8s-utils.ts#L185-L267):

- **DataFoundation** → MirrorPeer + DRPolicy, with pairing-progress UI and rollback.
- **ThirdParty** → Ramen S3 secret + `ramen-hub-operator-config` profile + DRCluster + DRPolicy,
  with rollback. No MirrorPeer.

So "route to the FA flow instead of the ODF flow" is already a solved problem mechanically. Good news
for effort estimation.

### 2.6 The detection surface we read is the legacy ODF-shaped one

The wizard still gets its per-cluster storage facts from the **MCV-based `odf-info` ConfigMap**,
fetched via a `ManagedClusterView` selector in
[select-cluster-list.tsx:242-251](../packages/mco/components/create-dr-policy/wizard-steps/clusters-step/select-cluster-list.tsx#L242-L251).
Its schema is ODF-shaped all the way down: `ODFInfoYamlObject` is
`{ version, deploymentType, clients, storageCluster: { namespacedName, storageProviderEndpoint,
cephClusterFSID } }` ([odf-mco.ts](../packages/mco/types/odf-mco.ts)), one StorageCluster per managed
cluster, and every consumer in
[managed-cluster-info.ts](../packages/mco/utils/managed-cluster-info.ts) reflects that.

There is already a TODO to move off it
([select-cluster-list.tsx:269-270](../packages/mco/components/create-dr-policy/wizard-steps/clusters-step/select-cluster-list.tsx#L269-L270)):

```ts
// TODO: Switch from using the MCV-based odf-info ConfigMap to using
// the odf-client-info ConfigMap from the openshift-operators namespace
```

This is the load-bearing prerequisite for the epic. Note the shape mismatch is not incidental: a
schema with one `storageCluster` and one `cephFSID` cannot express "this cluster has ODF and CNSA",
which is the fact the whole epic turns on. Filed as **RHSTOR-9614**.

The TODO's target needs revising, though. `odf-client-info` is not a more agnostic surface, it is the
same ODF-shaped data projected onto the hub: MCO builds it by unmarshalling the spoke's `odf-info`
into `ocsv1alpha1.OdfInfoData` and re-emitting `ClientInfo` / `ProviderInfo`, which carries
`cephClusterFSID`, `infoCephBlockPools`, and `storageProviderEndpoint` and has no provider
discriminator. Moving to it is still worth doing, because reading one hub ConfigMap beats N MCV
round-trips, but it does not by itself buy us multi-provider awareness. See B1b in
[§1](#1-verdict).

---

## 3. Architectural constraint that shapes the answers to the open questions

**`DRCluster` is one CR per managed cluster, named after the cluster, holding exactly one
`s3ProfileName`** ([tps-payload-creator.ts:199-225](../packages/mco/utils/tps-payload-creator.ts#L199-L225),
[ramen.ts:29-38](../packages/mco/types/ramen.ts#L29-L38)). It is _not_ per storage provider.
`drpolicy-list-page.tsx:73-77` already reference-counts DRClusters across policies for cleanup for
this reason.

`DRPolicy.spec` has only `drClusters`, `schedulingInterval`, and `replicationClassSelector`
([ramen.ts:14-27](../packages/mco/types/ramen.ts#L14-L27)). The **only** field that can scope a
policy to a storage provider is `replicationClassSelector`, and today the console uses it solely for
the RBD-image-flatten label.

Read literally, this constrains two of the epic's open questions before anyone gets to design them.
Stated as my reading of the CR shapes, to be confirmed by Q2 to Q4 in §5. If Ramen has a model I
can't see from the console side, these conclusions change:

- _"Would multi-storage pairing be one flow or one flow per provider?"_ → It must be **one policy per
  provider**, because a single DRPolicy cannot carry two schedulingIntervals (FA needs `0m`, ODF-RDR
  needs `5m`). So: run the wizard once per provider, producing two DRPolicies over the same cluster
  pair.
- _"Are pairings per provider independently manageable?"_ → **Not fully, with today's CRs.** The
  DRCluster and its S3 profile are shared. Deleting the FA policy must not tear down the DRCluster
  the ODF policy still needs. The existing reference-count-on-delete logic covers the console side,
  but this needs Ramen confirmation, and the console will need to _display_ which provider a policy
  belongs to. There is no such column today; `Header(t)` in `drpolicy-list-page/helper` has no
  storage/backend column.

Flagging this as the highest-risk item: if PM expects "break the FA pairing without touching the ODF
pairing", that is a Ramen/MCO ask, not a console ask.

---

## 4. Proposed scope, in dependency order

| #   | Item                                                                                                                                                        | Depends on                                         | Console effort | Notes                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Generalise the `useStorageProvisioners` two-bucket split so supported providers are named individually instead of all counting as "Data Foundation"         | none                                               | S              | Paying back our own shortcut (§2.2), display-only. Not a detection mechanism and not on the critical path                                                |
| 2   | Migrate off the MCV-based `odf-info` ConfigMap onto MCO's hub-side aggregate, and rework `ManagedClusterInfoType` to be per-provider instead of ODF-shaped  | source swap: none. Per-provider modelling: **B1b** | M              | **RHSTOR-9614**, see §7. The load-bearing item. Split it: swap the source now, model per-provider once MCO's agnostic aggregate exists                   |
| 3   | Fix FA-MDR `schedulingInterval = 0m` and hide the interval input for FA                                                                                     | item 2 (or a weaker interim signal)                | S to M         | DFBUGS-8864. Needs a decision: model FA-MDR as `ReplicationType.SYNC`, or allow Async-with-`0m`. Sync is the cleaner mapping and needs no payload change |
| 4   | Show the backend selector whenever ≥2 backends are present on **both** clusters (drop the `!selectedClustersHaveODF` gate)                                  | items 1 and 2                                      | S              | Reverts `ebf342df` under a better condition                                                                                                              |
| 5   | Make the Configure and Policy steps fully backend-conditional (Submariner pre-pair check is ODF-only; RBD flatten is ODF-only; S3 form is third-party-only) | item 4                                             | M              | Steps 2 and 3 are already partly conditional, so extend rather than rebuild                                                                              |
| 6   | Surface the storage provider on the DRPolicy list / detail, and confirm independent teardown                                                                | **B2** + Ramen                                     | M to L         | No backend column exists today                                                                                                                           |
| 7   | FA-RDR flow                                                                                                                                                 | **B2**, undefined                                  | ?              | Cannot estimate                                                                                                                                          |

Items 1 to 5 are a realistic ODF-5.1 slice _if_ B1a (RHSTOR-9510), B1b (the MCO aggregation) and B1c
(the `MirrorPeer` API) all land early. B1b and B1c have no trackers, so they are the schedule risk,
not RHSTOR-9510. Items 6 and 7 should be split into their own stories once PM answers.

---

## 5. Open questions

Most of what follows is design work, not feasibility work, and I am not asking design to be settled
here. The split below is by _urgency_, not by importance:

- **§5.1** is the short list that actually gates this document. Without these answers I cannot say
  whether the epic is a console story or a cross-component effort, so I cannot size it.
- **§5.2** is design-phase, but the backend lead time is long enough that the questions are worth
  asking now so design isn't blocked when it starts.
- **§5.3** is design-phase and parked. Recorded here only so the design phase inherits them instead
  of rediscovering them.
- **§5.4** is PM scope, which gates all three.

Question numbers are stable across the tiers so they can be referenced from elsewhere in this
document. Everything is open-ended on purpose: I'm after the intended model, not a yes/no.

### 5.1 Gates this feasibility check

**Q15. Is there anything in this area already designed that we should be building against rather
than inventing?** _(Ramen + MCO)_
Asking this first, because it may answer several of the others. If there's a Ramen enhancement or a
multi-provider design doc in flight, the console should follow it instead of deriving a model from CR
shapes, which is what §3 of this document is currently doing.
_Gates: whether §3's inferred model stands at all._

**Q3. How do you expect Ramen to behave when two DRPolicies cover the same cluster pair with
different intervals?** _(Ramen: Benamar)_
This is the concrete 5.1 shape: an FA-MDR policy at `0m` and an ODF-RDR policy at `5m` over
`{c1, c2}`. Is that a supported topology today, something that works incidentally, or something that
needs work on your side?
_Gates: whether §4 items 4 to 6 are a console story or a cross-component epic._

**Q4. What is the intended lifecycle of `DRCluster` and its S3 profile when multiple providers are in
play?** _(Ramen: Benamar)_
`DRCluster` is one CR per managed cluster with a single `s3ProfileName`
([tps-payload-creator.ts:199-225](../packages/mco/utils/tps-payload-creator.ts#L199-L225)), with no
provider dimension. We already reference-count it on delete in the console
([drpolicy-list-page.tsx:73-77](../packages/mco/components/drpolicy-list-page/drpolicy-list-page.tsx#L73-L77)).
Should the two providers share one DRCluster and one bucket, or is per-provider isolation of the
metadata store something you'd want? What breaks in each direction?
_Gates: whether per-provider teardown (§4 item 6) is buildable in the console at all._

**Q8. What does `schedulingInterval: 0m` actually mean to Ramen for a stretched-filesystem backend,
and is `ReplicationType.SYNC` the right model for FA-MDR?** _(Ramen + CNSA)_
Our creation path only emits `0m` when the type is Sync
([k8s-utils.ts:122-123](../packages/mco/components/create-dr-policy/utils/k8s-utils.ts#L122-L123)),
while our status path treats `0m` as "no replication monitoring needed" and names FusionAccess
explicitly ([dr-status.ts:241-243](../packages/mco/utils/dr-status.ts#L241-L243)). Those two ends
disagree about what FA is. Which is the intended model? If FA-MDR is genuinely Sync, we'd rather fix
the type derivation than special-case the interval.
_Gates: whether DFBUGS-8864 is a small fix or a remodelling of the replication-type derivation._

**Q9. Is FA-RDR going to exist, and if so what replicates?** _(Ramen + CNSA)_
The epic lists FA-RDR UX as an open question. Before it's a UX question it's a backend one: is there
an async replication path for CNSA at all, and does it use VolSync like the current third-party path
does? DFBUGS-8864's symptom, VolSync PVCs landing on the passive cluster, suggests the current
plumbing assumes VolSync where it shouldn't.
_Gates: the scope boundary of the epic._

**Q10. What is the agnostic hub-side aggregate going to be, and is anyone building it?**
_(MCO: Rewant + CNSA: Rakesh)_
Reading MCO today, the pipeline is ODF-specific at every step: gated on the
`odfinfo.odf.openshift.io` ClusterClaim, MCV scoped to `odf-info`, unmarshalled into
`ocsv1alpha1.OdfInfoData`, emitted as `ClientInfo` / `ProviderInfo` with `cephClusterFSID` and
`infoCephBlockPools`. So `odf-client-info` is not the agnostic surface we can migrate onto. Three
parts to this:

1. Is the plan to reshape `odf-client-info` or to emit a second, agnostic ConfigMap alongside it?
2. What replaces the ODF-only entry point, given a cluster with only Fusion Access never gets a
   ClusterClaim, an MCV, or an entry today?
3. What does the resulting shape look like? A worked example for a cluster running both ODF and CNSA
   would answer most of this in one go.
   _Gates: sizing of RHSTOR-9614 (§7), and whether an MCO story needs opening before this epic can
   start._

**Q16. Is `MirrorPeer` being generalised, and to what?** _(MCO)_
`PeerRef` can only point at an OCS `StorageCluster`, `spec.items` is capped at one entry per cluster,
both key fields are CEL-immutable, and `isVersionCompatible` requires an ODF version that a non-ODF
provider will never have. So the pairing API cannot currently express an FA pairing, let alone two
providers on one pair. Is the plan a provider field on `PeerRef`, a new API version, or a separate
CRD? Note this is coupled to Q10: `GetKey(clusterName, storageClusterRef.Name)` is the join key into
`odf-client-info`, so the ConfigMap and the CRD have to move together.
_Gates: the console's `createMirrorPeer` / `fetchMirrorPeer` payloads, and the overall size of the
epic. This plus Q10 is the largest unknown here._

### 5.2 Design-phase, but worth asking now

These belong in design. They're here because the answers have a long lead time and design shouldn't
start by waiting on them.

**Q1. What is the intended unit of "a storage system" in a DR pairing, and how should a hub-side
consumer name it?** _(Ramen: Benamar)_
We currently treat a StorageClass `name/provisioner` pair as the identity
([§2.4](#24-we-already-read-ramens-storageid-then-throw-the-detail-away)), but Ramen labels
StorageClasses with `ramendr.openshift.io/storageid`, and MCO has `cephFSID`. Three overlapping
identifiers, and we don't know which one is authoritative for "these two clusters can replicate to
each other using _this_ storage system". What should we key on?

**Q2. Once a cluster pair has more than one replicable storage system, how does a DRPolicy say which
one it governs?** _(Ramen: Benamar)_
`DRPolicy.spec` gives us `drClusters`, `schedulingInterval`, and `replicationClassSelector`
([types/ramen.ts:14-27](../packages/mco/types/ramen.ts#L14-L27)). We use `replicationClassSelector`
today only for the RBD-flatten label. Is overloading it for provider scoping the intended direction,
is there a field we should be setting that the console doesn't model yet, or is the expectation that
Ramen infers scope from the workload rather than the policy?

**Q11. What should the agnostic detection surface actually carry?** _(MCO: Rewant + CNSA: Rakesh)_
Follows Q10. From the console's side the useful shape is, per managed cluster: provider identity,
version / supported-ness, a pairing identity (the Q1 answer), and the DR modes it supports. What can
CNSA realistically publish, and what would MCO need to derive? Gaps here become UI we can't build.

### 5.3 Design-phase, parked

Recorded so the design phase inherits them. No answer needed for this feasibility check.

**Q5. What should happen to an application whose PVCs span both providers?** _(Ramen: Benamar)_
A workload with an ODF RBD PVC and a CNSA PVC has to pick one DRPolicy at protect time. Is that a
supported case, an explicitly unsupported one we should block in the UI, or something Ramen splits
internally? If we should block it, what's the signal to block on?

**Q6. At protect time, what should the console filter the DRPolicy list by?** _(Ramen: Benamar)_
Today [assign-policy-view](../packages/mco/components/modals/app-manage-policies/assign-policy-view.tsx)
shows policies matching the cluster pair. With two policies per pair, we need a second axis. What
should that be: the workload's StorageClasses, its `storageid` labels, something on the placement, or
an explicit user choice?

**Q7. How should a hub-side consumer decide Metro vs Regional for a non-Ceph backend?**
_(Ramen + CNSA)_
The general form of Q8. We derive it from `cephFSID` equality
([select-replication-type.tsx:54-73](../packages/mco/components/create-dr-policy/wizard-steps/policy-step/select-replication-type.tsx#L54-L73)),
where a shared filesystem ID means Metro. There's no FA equivalent, so FA always falls through to
Async and gets the wrong interval (DFBUGS-8864). What's the right general-purpose signal here, and is
defining one part of RHSTOR-9510's scope or separate?

**Q12. How should the hub represent a cluster that has ODF and FA installed but only one of them
DR-ready?** _(MCO: Rewant + CNSA: Rakesh)_
`isValidODFVersion` is currently a single boolean that drives both "can this cluster be selected" and
"which backend do we route to"
([select-cluster-list.tsx:306-321](../packages/mco/components/create-dr-policy/wizard-steps/clusters-step/select-cluster-list.tsx#L306-L321)).
A per-provider readiness model has to replace it. Is that a shape you'd want to define, or should the
console define it and you feed it?

**Q13. What's the intended flow when a second storage provider is added to an already-paired cluster
pair?** _(Ramen + MCO)_
E.g. FA installed on two clusters that already have an ODF DRPolicy and a live MirrorPeer. Does the
user re-run policy creation, and does anything about the existing pairing need to change? Our wizard
currently assumes pairing is a first-time-only concern
([configure-cluster-pair-step.tsx:107](../packages/mco/components/create-dr-policy/wizard-steps/configure-cluster-pair-step/configure-cluster-pair-step.tsx#L107)).

**Q14. What's the teardown story you'd want us to expose?** _(Ramen + MCO)_
If a user removes the FA policy from a pair that still has an ODF policy, what's safe to delete and
what must survive, and is that something Ramen should enforce or the console? We'd rather not encode
the rule in the UI if it belongs in a controller.

### 5.4 For PM (Brian): not backend, but gates all of the above

- On a pair with both ODF and FA, is the 5.1 experience a chooser, or both policies created in one
  pass?
- Is "break the FA pairing while keeping the ODF pairing" a 5.1 requirement?
- Is FA-RDR in 5.1 scope at all, or MDR-only?

---

## 6. Risks

- **Detection regression risk.** `isValidODFVersion` drives more than the backend choice; loosening
  it affects cluster-row rendering and validation. Any change here needs the existing
  `create-dr-policy.spec.tsx` / `step-validation.spec.ts` suites extended, not just passing.
- **Sync/Async remodelling.** Deriving replication type from something other than `cephFSID` touches
  the disabled dropdown, the review step, and the payload. Contained, but it is the piece most likely
  to grow.
- **Schedule.** Items 3 to 5 are downstream of B1a (RHSTOR-9510, In Progress on the CNSA side), B1b
  (the MCO aggregation) and B1c (the `MirrorPeer` API). The two unowned ones are the real risk:
  RHSTOR-9510 can land in full and the console still has nothing to read and no way to express an FA
  pairing. The source-swap half of item 2 depends on none of them, which is the argument for
  splitting it out and starting it early: if the blockers slip, we still land the migration and only
  the FA-specific behaviour drops out of 5.1.
- **CRD-level change on a GA API.** B1c is not a field addition, it is a rework of `MirrorPeer`'s
  identity model, which means conversion or a new API version and a migration story for existing
  peerings. If that lands late in the release, the console work behind it compresses into whatever
  time is left.
- **Temptation to shortcut detection.** If the migration doesn't get scheduled, the quick path is to
  read the CNSA ClusterClaim and `ibm-spectrum-scale` ConfigMap straight from the wizard. It would
  work, and it would put vendor-specific detection in the UI. This risk is higher than I first
  assessed it, because MCO is not yet publishing an agnostic surface (B1b), so the "just read it
  ourselves" path is the only one that unblocks the console unilaterally. Worth closing off at
  planning rather than during implementation.

---

## 7. RHSTOR-9614: migrate console storage detection to the hub-side MCO surface

Filed as a child of RHSTOR-9511, but standalone enough to run on its own schedule.

**Summary:** Console: consume MCO's hub-side ConfigMap for managed-cluster storage detection instead
of per-cluster `odf-info` ManagedClusterViews

**Why now:** the DRPolicy wizard reads the legacy MCV-based `odf-info` ConfigMap, whose schema
assumes a single ODF StorageCluster per managed cluster. Every multi-storage behaviour this epic asks
for is downstream of getting off that schema, and the migration is worth doing on its own merits:
one hub-side read replaces N MCV round-trips.

**Caveat on the target, added after reading MCO.** `odf-client-info` as it exists today is not an
agnostic surface, it is the hub-side projection of the same ODF-shaped data (see B1b in
[§1](#1-verdict)). Migrating to it changes where we read from, not what we can express. The
per-provider modelling below therefore has to be built against whatever agnostic aggregate MCO
produces, which does not exist yet. Two ways to sequence this:

- **Split the story.** Do the source swap now against the current shape, keeping behaviour identical,
  and model per-provider separately once MCO's aggregate lands. Lower risk, delivers something.
- **Hold.** Wait for the MCO shape and do both at once. Avoids reworking the parse twice, but nothing
  ships until B1b does.

I'd take the split, with the second half explicitly blocked on B1b.

**Scope:**

- Replace the `ManagedClusterView` fetch of `odf-info` with a hub-side read of MCO's aggregate,
  retiring the `MCO_CREATED_BY_LABEL_KEY` MCV selector in
  [select-cluster-list.tsx:242-251](../packages/mco/components/create-dr-policy/wizard-steps/clusters-step/select-cluster-list.tsx#L242-L251).
- Rework `ODFInfoYamlObject` and `ODFConfigInfoType`
  ([odf-mco.ts](../packages/mco/types/odf-mco.ts)) from one-ODF-cluster-shaped to a per-provider
  collection.
- Rework `ManagedClusterInfoType.odfInfo` and `getManagedClusterInfoTypes`
  ([managed-cluster-info.ts](../packages/mco/utils/managed-cluster-info.ts)) accordingly, keeping the
  existing ODF behaviour bit-for-bit.
- Replace the `isValidODFVersion` boolean with per-provider readiness, and update its consumers:
  backend derivation
  ([select-cluster-list.tsx:306-321](../packages/mco/components/create-dr-policy/wizard-steps/clusters-step/select-cluster-list.tsx#L306-L321)),
  selector visibility
  ([configure-cluster-pair-step.tsx:68-73](../packages/mco/components/create-dr-policy/wizard-steps/configure-cluster-pair-step/configure-cluster-pair-step.tsx#L68-L73)),
  and row rendering.
- Update `create-dr-policy.spec.tsx`, whose fixtures hard-code `odf-info` ConfigMaps in six places.

**Explicitly out of scope:** any FA-specific UI, the backend selector change, and the FA-MDR
scheduling-interval fix. Those stay on the epic and depend on this.

**Acceptance criteria:**

- DRPolicy creation against two ODF clusters behaves exactly as it does today, with no MCV round-trip
  for storage info.
- `ManagedClusterInfoType` exposes storage capability per provider, with no Ceph-specific or
  ODF-specific field names in the shared shape.
- A cluster reporting two providers is represented as two entries, not one merged entry.
- Existing wizard specs pass against the new fixtures; new unit coverage for the multi-provider parse.

**Open dependency:** a worked example of `odf-client-info` for a cluster running both ODF and CNSA
(Q10). The migration can start against the ODF-only shape, but the per-provider modelling should not
be finalised without it.
