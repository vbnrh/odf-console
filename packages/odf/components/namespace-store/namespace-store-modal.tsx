import * as React from 'react';
import { CEPH_STORAGE_NAMESPACE } from '@odf/shared/constants';
import { CommonModalProps } from '@odf/shared/modals/common';
import { ModalBody } from '@odf/shared/modals/Modal';
import { useCustomTranslation } from '@odf/shared/useCustomTranslationHook';
import { Modal, ModalVariant } from '@patternfly/react-core';
import NamespaceStoreForm from './namespace-store-form';
import '../mcg-endpoints/noobaa-provider-endpoints.scss';

const NamespaceStoreModal: React.FC<NamespaceStoreModalProps> = (props) => {
  const { t } = useCustomTranslation();
  const { isOpen, closeModal } = props;

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeModal}
      variant={ModalVariant.small}
      title={t('Create new NamespaceStore')}
      hasNoBodyWrapper={true}
    >
      <div className="nb-endpoints__modal">
        <ModalBody>
          <p>
            {t(
              'Represents an underlying storage to be used as read or write target for the data in the namespace buckets.'
            )}
          </p>
          <NamespaceStoreForm
            namespace={CEPH_STORAGE_NAMESPACE}
            onCancel={closeModal}
            redirectHandler={closeModal}
          />
        </ModalBody>
      </div>
    </Modal>
  );
};

type NamespaceStoreModalProps = CommonModalProps<{
  namespace: string;
}>;

export default NamespaceStoreModal;
