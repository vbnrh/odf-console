import { StorageClassModel, PodModel, ProjectModel } from '@odf/shared/models';
import { PROJECTS, STORAGE_CLASSES, PODS } from '../constants';

export enum StorageDashboardQuery {
  PROJECTS_BY_USED = 'PROJECTS_BY_USED',
  RESILIENCY_PROGRESS = 'RESILIENCY_PROGRESS',
  PROJECTS_TOTAL_USED = 'PROJECTS_TOTAL_USED',
  CEPH_CAPACITY_USED = 'CEPH_CAPACITY_USED',
  STORAGE_CLASSES_TOTAL_USED = 'STORAGE_CLASSES_TOTAL_USED',
  STORAGE_CLASSES_BY_USED = 'STORAGE_CLASSES_BY_USED',
  PODS_BY_USED = 'PODS_BY_USED',
  PODS_TOTAL_USED = 'PODS_TOTAL_USED',
  CEPH_CAPACITY_TOTAL = 'CEPH_CAPACITY_TOATL',
  CEPH_CAPACITY_AVAILABLE = 'CEPH_CAPACITY_AVAILABLE',
  // Capacity Info Card
  RAW_CAPACITY_TOTAL = 'RAW_TOTAL_CAPACITY',
  RAW_CAPACITY_USED = 'RAW_CAPACITY_USED',
  // Pool Info
  POOL_CAPACITY_RATIO = 'POOL_CAPACITY_RATIO',
  POOL_SAVED_CAPACITY = 'POOL_SAVED_CAPACITY',
  // Utilization Queries
  UTILIZATION_IOPS_READ_QUERY = 'UTILIZATION_IOPS_READ_QUERY',
  UTILIZATION_IOPS_WRITE_QUERY = 'UTILIZATION_IOPS_WRITE_QUERY',
  UTILIZATION_LATENCY_READ_QUERY = 'UTILIZATION_LATENCY_READ_QUERY',
  UTILIZATION_LATENCY_WRITE_QUERY = 'UTILIZATION_LATENCY_WRITE_QUERY',
  UTILIZATION_THROUGHPUT_READ_QUERY = 'UTILIZATION_THROUGHPUT_READ_QUERY',
  UTILIZATION_THROUGHPUT_WRITE_QUERY = 'UTILIZATION_THROUGHPUT_WRITE_QUERY',
  UTILIZATION_RECOVERY_RATE_QUERY = 'UTILIZATION_RECOVERY_RATE_QUERY',
  USED_CAPACITY = 'USED_CAPACITY',
  REQUESTED_CAPACITY = 'REQUESTED_CAPACITY',
  // Pool Compression Details
  POOL_COMPRESSION_SAVINGS = 'POOL_COMPRESSION_SAVINGS',
  POOL_COMPRESSION_RATIO = 'POOL_COMPRESSION_RATIO',
  POOL_COMPRESSION_ELIGIBILITY = 'POOL_COMPRESSION_ELIGIBILITY',
  POOL_RAW_CAPACITY_USED = 'POOL_RAW_CAPACITY_USED',
  POOL_MAX_CAPACITY_AVAILABLE = 'POOL_MAX_CAPACITY_AVAILABLE',
  POOL_UTILIZATION_IOPS_QUERY = 'POOL_UTILIZATION_IOPS_QUERY',
  POOL_UTILIZATION_THROUGHPUT_QUERY = 'POOL_UTILIZATION_THROUGHPUT_QUERY',
}

export const DATA_RESILIENCY_QUERY = {
  [StorageDashboardQuery.RESILIENCY_PROGRESS]:
    '(ceph_pg_clean and ceph_pg_active)/ceph_pg_total',
};

export const CEPH_CAPACITY_BREAKDOWN_QUERIES = {
  [StorageDashboardQuery.PROJECTS_TOTAL_USED]:
    'sum(sum(topk by (namespace,persistentvolumeclaim) (1, kubelet_volume_stats_used_bytes) * on (namespace,persistentvolumeclaim) group_left(storageclass, provisioner) (kube_persistentvolumeclaim_info * on (storageclass)  group_left(provisioner) kube_storageclass_info {provisioner=~"(.*rbd.csi.ceph.com)|(.*cephfs.csi.ceph.com)|(ceph.rook.io/block)"})) by (namespace))',
  [StorageDashboardQuery.PROJECTS_BY_USED]:
    'sum(topk by (namespace,persistentvolumeclaim) (1, kubelet_volume_stats_used_bytes) * on (namespace,persistentvolumeclaim) group_left(storageclass, provisioner) (kube_persistentvolumeclaim_info * on (storageclass)  group_left(provisioner) kube_storageclass_info {provisioner=~"(.*rbd.csi.ceph.com)|(.*cephfs.csi.ceph.com)|(ceph.rook.io/block)"})) by (namespace)',
  [StorageDashboardQuery.STORAGE_CLASSES_TOTAL_USED]:
    'sum(sum(topk by (namespace,persistentvolumeclaim) (1, kubelet_volume_stats_used_bytes) * on (namespace,persistentvolumeclaim) group_left(storageclass, provisioner) (kube_persistentvolumeclaim_info * on (storageclass) group_left(provisioner) kube_storageclass_info {provisioner=~"(.*rbd.csi.ceph.com)|(.*cephfs.csi.ceph.com)|(ceph.rook.io/block)"})) by (storageclass, provisioner))',
  [StorageDashboardQuery.STORAGE_CLASSES_BY_USED]:
    'sum(topk by (namespace,persistentvolumeclaim) (1, kubelet_volume_stats_used_bytes) * on (namespace,persistentvolumeclaim) group_left(storageclass, provisioner) (kube_persistentvolumeclaim_info * on (storageclass) group_left(provisioner) kube_storageclass_info {provisioner=~"(.*rbd.csi.ceph.com)|(.*cephfs.csi.ceph.com)|(ceph.rook.io/block)"})) by (storageclass, provisioner)',
  [StorageDashboardQuery.PODS_TOTAL_USED]:
    'sum (((max by(namespace,persistentvolumeclaim) (kubelet_volume_stats_used_bytes)) * on (namespace,persistentvolumeclaim) group_right() ((kube_running_pod_ready*0+1) * on(namespace, pod)  group_right() kube_pod_spec_volumes_persistentvolumeclaims_info)) * on(namespace,persistentvolumeclaim) group_left(provisioner) (kube_persistentvolumeclaim_info * on (storageclass)  group_left(provisioner) kube_storageclass_info {provisioner=~"(.*rbd.csi.ceph.com)|(.*cephfs.csi.ceph.com)|(ceph.rook.io/block)"}))',
  [StorageDashboardQuery.PODS_BY_USED]:
    'sum by(namespace,pod) (((max by(namespace,persistentvolumeclaim) (kubelet_volume_stats_used_bytes)) * on (namespace,persistentvolumeclaim) group_right() ((kube_running_pod_ready*0+1) * on(namespace, pod)  group_right() kube_pod_spec_volumes_persistentvolumeclaims_info)) * on(namespace,persistentvolumeclaim) group_left(provisioner) (kube_persistentvolumeclaim_info * on (storageclass)  group_left(provisioner) kube_storageclass_info {provisioner=~"(.*rbd.csi.ceph.com)|(.*cephfs.csi.ceph.com)|(ceph.rook.io/block)"}))',
  [StorageDashboardQuery.CEPH_CAPACITY_TOTAL]: 'ceph_cluster_total_bytes',
  [StorageDashboardQuery.CEPH_CAPACITY_USED]:
    'sum(topk by (namespace,persistentvolumeclaim) (1, kubelet_volume_stats_used_bytes) * on (namespace,persistentvolumeclaim) group_left(storageclass, provisioner) (kube_persistentvolumeclaim_info * on (storageclass)  group_left(provisioner) kube_storageclass_info {provisioner=~"(.*rbd.csi.ceph.com)|(.*cephfs.csi.ceph.com)"}))',
  [StorageDashboardQuery.CEPH_CAPACITY_AVAILABLE]:
    'max(ceph_pool_max_avail * on (pool_id) group_left(name)ceph_pool_metadata{name=~"(.*file.*)|(.*block.*)"})',
};

export const breakdownQueryMapCEPH = {
  [PROJECTS]: {
    model: ProjectModel,
    metric: 'namespace',
    queries: {
      [StorageDashboardQuery.PROJECTS_BY_USED]: `(topk(6,(${
        CEPH_CAPACITY_BREAKDOWN_QUERIES[StorageDashboardQuery.PROJECTS_BY_USED]
      })))`,
      [StorageDashboardQuery.PROJECTS_TOTAL_USED]:
        CEPH_CAPACITY_BREAKDOWN_QUERIES[
          StorageDashboardQuery.PROJECTS_TOTAL_USED
        ],
      [StorageDashboardQuery.CEPH_CAPACITY_USED]:
        CEPH_CAPACITY_BREAKDOWN_QUERIES[
          StorageDashboardQuery.CEPH_CAPACITY_USED
        ],
    },
  },
  [STORAGE_CLASSES]: {
    model: StorageClassModel,
    metric: 'storageclass',
    queries: {
      [StorageDashboardQuery.STORAGE_CLASSES_BY_USED]: `(topk(6,(${
        CEPH_CAPACITY_BREAKDOWN_QUERIES[
          StorageDashboardQuery.STORAGE_CLASSES_BY_USED
        ]
      })))`,
      [StorageDashboardQuery.STORAGE_CLASSES_TOTAL_USED]:
        CEPH_CAPACITY_BREAKDOWN_QUERIES[
          StorageDashboardQuery.STORAGE_CLASSES_TOTAL_USED
        ],
      [StorageDashboardQuery.CEPH_CAPACITY_USED]:
        CEPH_CAPACITY_BREAKDOWN_QUERIES[
          StorageDashboardQuery.CEPH_CAPACITY_USED
        ],
    },
  },
  [PODS]: {
    model: PodModel,
    metric: 'pod',
    queries: {
      [StorageDashboardQuery.PODS_BY_USED]: `(topk(6,(${
        CEPH_CAPACITY_BREAKDOWN_QUERIES[StorageDashboardQuery.PODS_BY_USED]
      })))`,
      [StorageDashboardQuery.PODS_TOTAL_USED]:
        CEPH_CAPACITY_BREAKDOWN_QUERIES[StorageDashboardQuery.PODS_TOTAL_USED],
      [StorageDashboardQuery.CEPH_CAPACITY_USED]:
        CEPH_CAPACITY_BREAKDOWN_QUERIES[
          StorageDashboardQuery.CEPH_CAPACITY_USED
        ],
    },
  },
};

export const CAPACITY_INFO_QUERIES = {
  [StorageDashboardQuery.RAW_CAPACITY_TOTAL]: 'ceph_cluster_total_bytes',
  [StorageDashboardQuery.RAW_CAPACITY_USED]:
    'ceph_cluster_total_used_raw_bytes',
};

export const POOL_STORAGE_EFFICIENCY_QUERIES = {
  [StorageDashboardQuery.POOL_CAPACITY_RATIO]:
    'sum(ceph_bluestore_bluestore_compressed_original) / clamp_min(sum(ceph_bluestore_bluestore_compressed_allocated),1)',
  [StorageDashboardQuery.POOL_SAVED_CAPACITY]:
    '(sum(ceph_bluestore_bluestore_compressed_original) - sum(ceph_bluestore_bluestore_compressed_allocated))',
};

export const UTILIZATION_QUERY = {
  [StorageDashboardQuery.CEPH_CAPACITY_USED]:
    'sum(topk by (namespace,persistentvolumeclaim) (1, kubelet_volume_stats_used_bytes) * on (namespace,persistentvolumeclaim) group_left(storageclass, provisioner) (kube_persistentvolumeclaim_info * on (storageclass)  group_left(provisioner) kube_storageclass_info {provisioner=~"(.*rbd.csi.ceph.com)|(.*cephfs.csi.ceph.com)"}))',
  [StorageDashboardQuery.UTILIZATION_IOPS_READ_QUERY]: {
    query: 'sum(rate(ceph_pool_rd[1m]))',
    desc: 'Reads',
  },
  [StorageDashboardQuery.UTILIZATION_IOPS_WRITE_QUERY]: {
    query: 'sum(rate(ceph_pool_wr[1m]))',
    desc: 'Writes',
  },
  [StorageDashboardQuery.UTILIZATION_LATENCY_READ_QUERY]: {
    query: 'cluster:ceph_disk_latency_read:join_ceph_node_disk_rate1m',
    desc: 'Reads',
  },
  [StorageDashboardQuery.UTILIZATION_LATENCY_WRITE_QUERY]: {
    query: 'cluster:ceph_disk_latency_write:join_ceph_node_disk_rate1m',
    desc: 'Writes',
  },
  [StorageDashboardQuery.UTILIZATION_THROUGHPUT_READ_QUERY]: {
    query: 'sum(rate(ceph_pool_rd_bytes[1m]))',
    desc: 'Reads',
  },
  [StorageDashboardQuery.UTILIZATION_THROUGHPUT_WRITE_QUERY]: {
    query: 'sum(rate(ceph_pool_wr_bytes[1m]))',
    desc: 'Writes',
  },
  [StorageDashboardQuery.UTILIZATION_RECOVERY_RATE_QUERY]:
    '(sum(ceph_pool_recovering_bytes_per_sec))',
};

export const utilizationPopoverQueryMap = [
  {
    model: ProjectModel,
    metric: 'namespace',
    query: `(sort_desc(topk(25,(${
      CEPH_CAPACITY_BREAKDOWN_QUERIES[StorageDashboardQuery.PROJECTS_BY_USED]
    }))))`,
  },
  {
    model: StorageClassModel,
    metric: 'storageclass',
    query: `(sort_desc(topk(25,(${
      CEPH_CAPACITY_BREAKDOWN_QUERIES[
        StorageDashboardQuery.STORAGE_CLASSES_BY_USED
      ]
    }))))`,
  },
  {
    model: PodModel,
    metric: 'pod',
    query: `(sort_desc(topk(25, (${
      CEPH_CAPACITY_BREAKDOWN_QUERIES[StorageDashboardQuery.PODS_BY_USED]
    }))))`,
  },
];

export const getPoolQuery = (
  poolNames: string[],
  queryName: StorageDashboardQuery
) => {
  const names = poolNames.join('|');
  const queries = {
    [StorageDashboardQuery.POOL_RAW_CAPACITY_USED]: `ceph_pool_bytes_used * on (pool_id) group_left(name)ceph_pool_metadata{name=~'${names}'}`,
    [StorageDashboardQuery.POOL_MAX_CAPACITY_AVAILABLE]: `ceph_pool_max_avail * on (pool_id) group_left(name)ceph_pool_metadata{name=~'${names}'}`,
    [StorageDashboardQuery.POOL_UTILIZATION_IOPS_QUERY]: `(rate(ceph_pool_wr[1m]) + rate(ceph_pool_rd[1m])) * on (pool_id) group_left(name)ceph_pool_metadata{name=~'${names}'}`,
    [StorageDashboardQuery.POOL_UTILIZATION_THROUGHPUT_QUERY]: `(rate(ceph_pool_wr_bytes[1m]) + rate(ceph_pool_rd_bytes[1m])) * on (pool_id) group_left(name)ceph_pool_metadata{name=~'${names}'}`,
    [StorageDashboardQuery.POOL_COMPRESSION_SAVINGS]: `(ceph_pool_compress_under_bytes - ceph_pool_compress_bytes_used) * on (pool_id) group_left(name)ceph_pool_metadata{name=~'${names}'}`,
    [StorageDashboardQuery.POOL_COMPRESSION_ELIGIBILITY]: `(((ceph_pool_compress_under_bytes > 0) / ceph_pool_stored_raw) * 100) * on (pool_id) group_left(name)ceph_pool_metadata{name=~'${names}'}`,
    [StorageDashboardQuery.POOL_COMPRESSION_RATIO]: `((ceph_pool_compress_under_bytes / ceph_pool_compress_bytes_used > 0) and on(pool_id) (((ceph_pool_compress_under_bytes > 0) / ceph_pool_stored_raw) * 100 > 0.5)) * on (pool_id) group_left(name)ceph_pool_metadata{name=~'${names}'}`,
  };
  return queries[queryName];
};

export const INDEPENDENT_UTILIZATION_QUERIES = {
  [StorageDashboardQuery.REQUESTED_CAPACITY]:
    'sum((kube_persistentvolumeclaim_resource_requests_storage_bytes * on (namespace,persistentvolumeclaim) group_right() kube_pod_spec_volumes_persistentvolumeclaims_info) * on (namespace,persistentvolumeclaim) group_left(storageclass, provisioner) (kube_persistentvolumeclaim_info * on (storageclass)  group_left(provisioner) kube_storageclass_info {provisioner=~"(.*rbd.csi.ceph.com)|(.*cephfs.csi.ceph.com)|(ceph.rook.io/block)"}))',
  [StorageDashboardQuery.USED_CAPACITY]:
    'sum((topk by (namespace,persistentvolumeclaim) (1, kubelet_volume_stats_used_bytes) * on (namespace,persistentvolumeclaim) group_right() kube_pod_spec_volumes_persistentvolumeclaims_info) * on (namespace,persistentvolumeclaim) group_left(storageclass, provisioner) (kube_persistentvolumeclaim_info * on (storageclass)  group_left(provisioner) kube_storageclass_info {provisioner=~"(.*rbd.csi.ceph.com)|(.*cephfs.csi.ceph.com)|(ceph.rook.io/block)"}))',
};

export const breakdownIndependentQueryMap = {
  [PROJECTS]: {
    model: ProjectModel,
    metric: 'namespace',
    queries: {
      [StorageDashboardQuery.PROJECTS_BY_USED]: `(topk(6,(${
        CEPH_CAPACITY_BREAKDOWN_QUERIES[StorageDashboardQuery.PROJECTS_BY_USED]
      })))`,
      [StorageDashboardQuery.PROJECTS_TOTAL_USED]:
        CEPH_CAPACITY_BREAKDOWN_QUERIES[
          StorageDashboardQuery.PROJECTS_TOTAL_USED
        ],
    },
  },
  [STORAGE_CLASSES]: {
    model: StorageClassModel,
    metric: 'storageclass',
    queries: {
      [StorageDashboardQuery.STORAGE_CLASSES_BY_USED]: `(topk(6,(${
        CEPH_CAPACITY_BREAKDOWN_QUERIES[
          StorageDashboardQuery.STORAGE_CLASSES_BY_USED
        ]
      })))`,
      [StorageDashboardQuery.STORAGE_CLASSES_TOTAL_USED]:
        CEPH_CAPACITY_BREAKDOWN_QUERIES[
          StorageDashboardQuery.STORAGE_CLASSES_TOTAL_USED
        ],
    },
  },
  [PODS]: {
    model: PodModel,
    metric: 'pod',
    queries: {
      [StorageDashboardQuery.PODS_BY_USED]: `(topk(6,(${
        CEPH_CAPACITY_BREAKDOWN_QUERIES[StorageDashboardQuery.PODS_BY_USED]
      })))`,
      [StorageDashboardQuery.PODS_TOTAL_USED]:
        CEPH_CAPACITY_BREAKDOWN_QUERIES[StorageDashboardQuery.PODS_TOTAL_USED],
    },
  },
};
