import type { CandidateFormValues } from './CandidateForm';

type CandidateDraft = CandidateFormValues;

interface DraftTransport {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

interface CandidateDraftStorage {
  load: (draftKey: string) => CandidateDraft | null;
  save: (draftKey: string, values: CandidateDraft) => void;
  clear: (draftKey: string) => void;
}

const STORAGE_PREFIX = 'crm-lg:v1:candidate-draft:';

function keyFor(draftKey: string): string {
  return `${STORAGE_PREFIX}${draftKey}`;
}

function getLocalStorageTransport(): DraftTransport | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function createCandidateDraftStorage(transport: DraftTransport | null): CandidateDraftStorage {
  return {
    load: (draftKey) => {
      if (!transport) return null;
      try {
        const raw = transport.getItem(keyFor(draftKey));
        if (!raw) return null;
        return JSON.parse(raw) as CandidateDraft;
      } catch {
        return null;
      }
    },
    save: (draftKey, values) => {
      if (!transport) return;
      try {
        transport.setItem(keyFor(draftKey), JSON.stringify(values));
      } catch {
        // ignore quota and serialization issues in draft persistence
      }
    },
    clear: (draftKey) => {
      if (!transport) return;
      try {
        transport.removeItem(keyFor(draftKey));
      } catch {
        // ignore storage errors during cleanup
      }
    },
  };
}

export const candidateDraftStorage = createCandidateDraftStorage(getLocalStorageTransport());
