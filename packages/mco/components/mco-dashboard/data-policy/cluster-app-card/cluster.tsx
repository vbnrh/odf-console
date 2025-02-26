/**
 * Add components specific to cluster-wise card
 */

import * as React from 'react';
import { getTotalPVCCountPerClusterQuery } from '@odf/mco/components/mco-dashboard/queries';
import {
  ODR_CLUSTER_OPERATOR,
  VOL_SYNC,
  HUB_CLUSTER_NAME,
  ACM_ENDPOINT,
  VOLUME_REPLICATION_HEALTH,
  OBJECT_NAMESPACE,
  OBJECT_NAME,
} from '@odf/mco/constants';
import { MirrorPeerModel } from '@odf/mco/models';
import {
  DrClusterAppsMap,
  MirrorPeerKind,
  PlacementInfo,
  ProtectedPVCData,
} from '@odf/mco/types';
import {
  getVolumeReplicationHealth,
  getManagedClusterAvailableCondition,
} from '@odf/mco/utils';
import HealthItem from '@odf/shared/dashboards/status-card/HealthItem';
import { healthStateMapping } from '@odf/shared/dashboards/status-card/states';
import { useCustomPrometheusPoll } from '@odf/shared/hooks/custom-prometheus-poll';
import Status, { StatusPopupSection } from '@odf/shared/popup/status-popup';
import { useCustomTranslation } from '@odf/shared/useCustomTranslationHook';
import { referenceForModel } from '@odf/shared/utils';
import {
  HealthState,
  PrometheusResponse,
  PrometheusResult,
  useK8sWatchResource,
  StatusIconAndText,
} from '@openshift-console/dynamic-plugin-sdk';
import { Flex, Text, TextVariants } from '@patternfly/react-core';
import { ConnectedIcon } from '@patternfly/react-icons';
import { StatusText } from './common';

const OperatorsHealthPopUp: React.FC<OperatorsHealthPopUpProps> = ({
  clusterCSVStatus,
}) => {
  const { t } = useCustomTranslation();

  return (
    <Flex direction={{ default: 'column' }}>
      <StatusText>{t('Operator health')}</StatusText>
      <Flex data-test="operator-health-description">
        {t(
          'Operators are responsible for maintaining and reconciling the state of the cluster.'
        )}
      </Flex>
      <Flex>
        <StatusPopupSection firstColumn="Operators" secondColumn="Status">
          <Status
            icon={
              healthStateMapping[
                clusterCSVStatus?.[ODR_CLUSTER_OPERATOR] !== '1'
                  ? HealthState.ERROR
                  : HealthState.OK
              ].icon
            }
            value={
              clusterCSVStatus?.[ODR_CLUSTER_OPERATOR] !== '1'
                ? t('Degraded')
                : t('Healthy')
            }
          >
            {t('DR Cluster operator')}
          </Status>
          <Status
            icon={
              healthStateMapping[
                clusterCSVStatus?.[VOL_SYNC] !== '1'
                  ? HealthState.ERROR
                  : HealthState.OK
              ].icon
            }
            value={
              clusterCSVStatus?.[VOL_SYNC] !== '1'
                ? t('Degraded')
                : t('Healthy')
            }
          >
            {t('VolSync')}
          </Status>
        </StatusPopupSection>
      </Flex>
    </Flex>
  );
};

export const HealthSection: React.FC<HealthSectionProps> = ({
  clusterResources,
  csvData,
  clusterName,
}) => {
  const { t } = useCustomTranslation();

  const clusterCSVStatus = React.useMemo(
    () =>
      csvData?.data?.result?.reduce((acc, item: PrometheusResult) => {
        if (item?.metric.cluster === clusterName) {
          item?.metric.name.startsWith(ODR_CLUSTER_OPERATOR) &&
            (acc[ODR_CLUSTER_OPERATOR] = item?.value[1]);
          item?.metric.name.startsWith(VOL_SYNC) &&
            (acc[VOL_SYNC] = item?.value[1]);
        }
        return acc;
      }, {} as ClusterCSVStatus) || ({} as ClusterCSVStatus),
    [csvData, clusterName]
  );

  return (
    <div className="mco-cluster-app__cluster-health-section">
      <StatusText>{t('Health')}</StatusText>
      <HealthItem
        title={t('Cluster health')}
        state={
          !!getManagedClusterAvailableCondition(
            clusterResources[clusterName]?.managedCluster
          )
            ? HealthState.OK
            : HealthState.ERROR
        }
      />
      <HealthItem
        title={t('Operators health')}
        // for csv status metrics, '1' means healthy
        state={
          clusterCSVStatus?.[ODR_CLUSTER_OPERATOR] !== '1' ||
          clusterCSVStatus?.[VOL_SYNC] !== '1'
            ? HealthState.ERROR
            : HealthState.OK
        }
      >
        <OperatorsHealthPopUp clusterCSVStatus={clusterCSVStatus} />
      </HealthItem>
    </div>
  );
};

export const PeerConnectionSection: React.FC<PeerConnectionSectionProps> = ({
  clusterName,
}) => {
  const { t } = useCustomTranslation();
  const [mirrorPeers, mirrorPeersLoaded, mirrorPeersError] =
    useK8sWatchResource<MirrorPeerKind[]>({
      kind: referenceForModel(MirrorPeerModel),
      isList: true,
      namespaced: false,
      cluster: HUB_CLUSTER_NAME,
    });

  const peerConnectedCount = React.useMemo(() => {
    if (mirrorPeersLoaded && !mirrorPeersError) {
      return (
        mirrorPeers.reduce((acc, mirrorPeer: MirrorPeerKind) => {
          if (
            !!mirrorPeer?.spec?.items?.find(
              (item) => item?.clusterName === clusterName
            )
          ) {
            return acc + 1;
          }
          return acc;
        }, 0) || 0
      );
    }
    return 0;
  }, [clusterName, mirrorPeers, mirrorPeersLoaded, mirrorPeersError]);

  return (
    <div className="mco-dashboard__contentColumn">
      <StatusText>{t('Peer connection')}</StatusText>
      <StatusIconAndText
        title={t(' {{ peerConnectedCount }} Connected', {
          peerConnectedCount,
        })}
        icon={<ConnectedIcon />}
        className="text-muted"
      />
    </div>
  );
};

export const ApplicationsSection: React.FC<ApplicationsSectionProps> = ({
  clusterResources,
  clusterName,
  lastSyncTimeData,
}) => {
  const { t } = useCustomTranslation();

  const appsWithIssues = React.useMemo(
    () =>
      clusterResources[clusterName]?.protectedAppSets?.reduce(
        (acc, protectedAppSetsMap) => {
          const placementInfo: PlacementInfo =
            protectedAppSetsMap?.placementInfo?.[0];
          const hasIssue = !!lastSyncTimeData?.data?.result?.find(
            (item: PrometheusResult) =>
              item?.metric?.[OBJECT_NAMESPACE] ===
                placementInfo?.drpcNamespace &&
              item?.metric?.[OBJECT_NAME] === placementInfo?.drpcName &&
              getVolumeReplicationHealth(
                Number(item?.value[1]) || 0,
                placementInfo?.syncInterval
              )[0] !== VOLUME_REPLICATION_HEALTH.HEALTHY
          );
          return hasIssue ? acc + 1 : acc;
        },
        0
      ) || 0,
    [clusterResources, clusterName, lastSyncTimeData]
  );

  const totalAppSetsCount = clusterResources[clusterName]?.totalAppSetsCount;
  const protectedAppSetsCount =
    clusterResources[clusterName]?.protectedAppSets?.length;
  return (
    <div className="mco-dashboard__contentColumn">
      <Text component={TextVariants.h1}>{totalAppSetsCount || 0}</Text>
      <StatusText>{t('Total applications')}</StatusText>
      <Text className="text-muted mco-dashboard__statusText--margin">
        {t(' {{ protectedAppSetsCount }} protected apps', {
          protectedAppSetsCount,
        })}
      </Text>
      <Text className="text-muted">
        {t(
          ' {{ appsWithIssues }} of {{ protectedAppSetsCount }} apps with issues',
          { appsWithIssues, protectedAppSetsCount }
        )}
      </Text>
    </div>
  );
};

export const PVCsSection: React.FC<PVCsSectionProps> = ({
  protectedPVCData,
  clusterName,
}) => {
  const { t } = useCustomTranslation();
  const [pvcsCount] = useCustomPrometheusPoll({
    endpoint: 'api/v1/query' as any,
    query: !!clusterName ? getTotalPVCCountPerClusterQuery(clusterName) : null,
    basePath: ACM_ENDPOINT,
    cluster: HUB_CLUSTER_NAME,
  });
  let totalPVCsCount = pvcsCount?.data?.result?.[0]?.value?.[1] || '0';
  let protectedPVCsCount = protectedPVCData?.length || 0;

  return (
    <div className="mco-dashboard__contentColumn">
      <Text component={TextVariants.h1}>{totalPVCsCount}</Text>
      <StatusText>{t('PVCs')}</StatusText>
      <Text className="text-muted">
        {t(' {{ protectedPVCsCount }} protected', {
          protectedPVCsCount,
        })}
      </Text>
    </div>
  );
};

type ClusterCSVStatus = {
  [ODR_CLUSTER_OPERATOR]: string;
  [VOL_SYNC]: string;
};

type OperatorsHealthPopUpProps = {
  clusterCSVStatus: ClusterCSVStatus;
};

type HealthSectionProps = {
  clusterResources: DrClusterAppsMap;
  csvData: PrometheusResponse;
  clusterName: string;
};

type PeerConnectionSectionProps = {
  clusterName: string;
};

type ApplicationsSectionProps = {
  clusterResources: DrClusterAppsMap;
  clusterName: string;
  lastSyncTimeData: PrometheusResponse;
};

type PVCsSectionProps = {
  protectedPVCData: ProtectedPVCData[];
  clusterName: string;
};
