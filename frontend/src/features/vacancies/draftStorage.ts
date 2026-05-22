import type { VacancyFormValues } from './VacancyForm';

type VacancyDraft = Partial<VacancyFormValues>;

interface DraftTransport {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

interface VacancyDraftStorage {
  load: (draftKey: string) => VacancyDraft | null;
  save: (draftKey: string, values: VacancyDraft) => void;
  clear: (draftKey: string) => void;
}

const STORAGE_PREFIX = 'crm-lg:v1:vacancy-draft:';

function keyFor(draftKey: string): string {
  return `${STORAGE_PREFIX}${draftKey}`;
}

function getLocalStorageTransport(): DraftTransport | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function createVacancyDraftStorage(transport: DraftTransport | null): VacancyDraftStorage {
  return {
    load: (draftKey) => {
      if (!transport) return null;
      try {
        const raw = transport.getItem(keyFor(draftKey));
        if (!raw) return null;
        return JSON.parse(raw) as VacancyDraft;
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

export const vacancyDraftStorage = createVacancyDraftStorage(getLocalStorageTransport());
