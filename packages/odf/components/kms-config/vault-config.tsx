import * as React from 'react';
import { useDeepCompareMemoize } from '@odf/shared/hooks/deep-compare-memoize';
import { useModalLauncher } from '@odf/shared/modals/modalLauncher';
import { useCustomTranslation } from '@odf/shared/useCustomTranslationHook';
import { useFlag } from '@openshift-console/dynamic-plugin-sdk';
import { global_palette_blue_300 as blueInfoColor } from '@patternfly/react-tokens/dist/js/global_palette_blue_300';
import { TFunction } from 'i18next';
import * as _ from 'lodash-es';
import {
  FormGroup,
  FormSelect,
  FormSelectOption,
  Button,
} from '@patternfly/react-core';
import { PencilAltIcon } from '@patternfly/react-icons';
import { ProviderStateMap } from '../../constants';
import { FEATURES } from '../../features';
import {
  VaultConfig,
  ProviderNames,
  VaultAuthMethods,
  KmsEncryptionLevel,
  VaultAuthMethodMapping,
} from '../../types';
import { NameAddrPort, isValid } from './name-address-port';
import { KMSConfigureProps, EncryptionDispatch } from './providers';
import { kmsConfigValidation, isLengthUnity } from './utils';
import {
  VaultTokenConfigure,
  VaultServiceAccountConfigure,
  VaultAuthMethodProps,
} from './vault-auth-methods';
import './kms-config.scss';

const LAUNCH_MODAL_KEY = 'ADVANCED_VAULT';

export const VaultConfigure: React.FC<KMSConfigureProps> = ({
  state,
  dispatch,
  className,
  isWizardFlow,
  isMCG,
}) => {
  const { t } = useCustomTranslation();

  const [Modal, modalProps, launchModal] = useModalLauncher(extraMap);
  const isKmsVaultSASupported = useFlag(FEATURES.ODF_VAULT_SA_KMS);

  const vaultState = useDeepCompareMemoize(
    state.kms.providerState,
    true
  ) as VaultConfig;
  const vaultStateClone: VaultConfig = React.useMemo(
    () => _.cloneDeep(vaultState),
    [vaultState]
  );

  const { encryption } = state;
  const isScEncryption = encryption.storageClass;

  const openAdvancedModal = () =>
    launchModal(LAUNCH_MODAL_KEY, {
      state,
      dispatch,
      isWizardFlow,
    });

  const updateVaultState = React.useCallback(
    (vaultConfig: VaultConfig) =>
      dispatch({
        type: 'securityAndNetwork/setKmsProviderState',
        payload: vaultConfig,
      }),
    [dispatch]
  );

  const setAuthValue = React.useCallback(
    (authValue: string) => {
      vaultStateClone.authValue.value = authValue;
      vaultStateClone.authValue.valid = authValue !== '';
      updateVaultState(vaultStateClone);
    },
    [updateVaultState, vaultStateClone]
  );

  const setAuthMethod = React.useCallback(
    (authMethod: VaultAuthMethods) => {
      if (!!vaultStateClone.authMethod) {
        vaultStateClone.authValue =
          ProviderStateMap[ProviderNames.VAULT].authValue;
      }
      vaultStateClone.authMethod = authMethod;
      updateVaultState(vaultStateClone);
    },
    [updateVaultState, vaultStateClone]
  );

  const filteredVaultAuthMethodMapping = React.useMemo(
    () =>
      Object.values(VaultAuthMethodMapping).filter(
        (authMethod) =>
          (encryption.clusterWide || isMCG
            ? authMethod.supportedEncryptionType.includes(
                KmsEncryptionLevel.CLUSTER_WIDE
              )
            : false) ||
          (encryption.storageClass
            ? authMethod.supportedEncryptionType.includes(
                KmsEncryptionLevel.STORAGE_CLASS
              )
            : false)
      ),
    [encryption.clusterWide, encryption.storageClass, isMCG]
  );

  const vaultAuthMethods = React.useMemo(
    () => filteredVaultAuthMethodMapping.map((authMethod) => authMethod.value),
    [filteredVaultAuthMethodMapping]
  );

  React.useEffect(() => {
    if (!vaultAuthMethods.includes(vaultState.authMethod)) {
      if (
        isKmsVaultSASupported &&
        vaultAuthMethods.includes(VaultAuthMethods.KUBERNETES)
      ) {
        // From 4.10 kubernetes is default auth method
        setAuthMethod(VaultAuthMethods.KUBERNETES);
      } else {
        // upto 4.9 token is the default auth method
        setAuthMethod(VaultAuthMethods.TOKEN);
      }
    }
  }, [
    isKmsVaultSASupported,
    setAuthMethod,
    vaultAuthMethods,
    vaultState.authMethod,
  ]);

  return (
    <>
      <Modal {...modalProps} />
      {isKmsVaultSASupported && (
        <FormGroup
          fieldId="authentication-method"
          label={t('Authentication method')}
          className={`${className}__form-body`}
          helperTextInvalid={t('This is a required field')}
          isRequired
        >
          <FormSelect
            value={vaultState.authMethod}
            onChange={setAuthMethod}
            id="authentication-method"
            name="authentication-method"
            aria-label={t('authentication-method')}
            isDisabled={isLengthUnity(vaultAuthMethods)}
            data-test="vault-config-auth-method"
          >
            {filteredVaultAuthMethodMapping.map((authMethod) => (
              <FormSelectOption
                value={authMethod.value}
                label={authMethod.name}
                key={authMethod.name}
              />
            ))}
          </FormSelect>
        </FormGroup>
      )}
      <ValutConnectionForm
        {...{
          t,
          isScEncryption,
          vaultState,
          className,
          isWizardFlow,
          dispatch,
          updateVaultState,
          setAuthValue,
          openAdvancedModal,
        }}
      />
    </>
  );
};

const extraMap = {
  [LAUNCH_MODAL_KEY]: React.lazy(
    () => import('../../modals/advanced-kms-modal/advanced-vault-modal')
  ),
};

const ValutConnectionForm: React.FC<ValutConnectionFormProps> = ({
  t,
  isScEncryption,
  vaultState,
  className,
  isWizardFlow,
  dispatch,
  updateVaultState,
  setAuthValue,
  openAdvancedModal,
}) => {
  const vaultStateClone: VaultConfig = _.cloneDeep(vaultState);
  const Component: React.FC<VaultAuthMethodProps> =
    vaultState.authMethod === VaultAuthMethods.TOKEN
      ? VaultTokenConfigure
      : VaultServiceAccountConfigure;

  React.useEffect(() => {
    // only need to pass authValue for wizard flow
    const validAuthValue: boolean = isWizardFlow
      ? vaultState.authValue?.valid && vaultState.authValue?.value !== ''
      : true;
    const hasHandled: boolean =
      validAuthValue && kmsConfigValidation(vaultState, ProviderNames.VAULT);
    if (vaultState.hasHandled !== hasHandled) {
      dispatch({
        type: 'securityAndNetwork/setKmsProviderState',
        payload: {
          ...vaultState,
          hasHandled,
        },
      });
    }
  }, [dispatch, vaultState, isWizardFlow]);

  return (
    <>
      <NameAddrPort
        className={className}
        kmsState={vaultState}
        kmsStateClone={vaultStateClone}
        updateKmsState={updateVaultState}
        canAcceptIP={false}
      />
      {isWizardFlow && (
        <Component
          {...{
            t,
            className: `${className}__form-body`,
            vaultState,
            setAuthValue,
            isValid,
            isScEncryption,
          }}
        />
      )}
      <Button
        variant="link"
        className={`${className}__form-body`}
        onClick={openAdvancedModal}
        data-test="kms-advanced-settings-link"
      >
        {t('Advanced settings')}{' '}
        {(vaultState.backend ||
          vaultState.caCert ||
          vaultState.tls ||
          vaultState.clientCert ||
          vaultState.clientKey ||
          vaultState.providerNamespace) && (
          <PencilAltIcon
            data-test="edit-icon"
            size="sm"
            color={blueInfoColor.value}
          />
        )}
      </Button>
    </>
  );
};

export type ValutConnectionFormProps = {
  isScEncryption?: boolean;
  vaultState: VaultConfig;
  className: string;
  infraType?: string;
  isWizardFlow?: boolean;
  t: TFunction;
  dispatch: EncryptionDispatch;
  updateVaultState: (VaultConfig) => void;
  setAuthValue: (string) => void;
  openAdvancedModal: () => void;
};
