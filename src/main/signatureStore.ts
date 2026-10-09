import type { SavedSignature } from '../shared/types';

// T0 stub. T3 implements: userData/signatures/<uuid>.png + index.json.

export function listSignatures(): Promise<SavedSignature[]> {
  throw new Error('NotImplemented: signatureStore.listSignatures');
}

export function addSignature(
  _sig: Omit<SavedSignature, 'id' | 'createdAt'>,
): Promise<SavedSignature> {
  throw new Error('NotImplemented: signatureStore.addSignature');
}

export function deleteSignature(_id: string): Promise<void> {
  throw new Error('NotImplemented: signatureStore.deleteSignature');
}
