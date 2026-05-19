import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useCandidates } from '@/features/candidates/hooks';
import { useAttachCandidate } from './hooks';
import type { UUID } from '@/api/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vacancyId: UUID;
}

export function AttachCandidateDialog({ open, onOpenChange, vacancyId }: Props) {
  const [search, setSearch] = useState('');
  const { data } = useCandidates({ search });
  const attach = useAttachCandidate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Прикрепить кандидата</DialogTitle></DialogHeader>
        <Input placeholder="Поиск по имени / стеку" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {(data?.items ?? []).map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <div>
                <div className="font-semibold">{c.fullName}</div>
                <div className="text-xs text-muted-foreground">{c.role} · {c.grade}</div>
              </div>
              <Button
                size="sm"
                onClick={() => attach.mutate({ vacancyId, candidateId: c.id }, { onSuccess: () => onOpenChange(false) })}
                disabled={attach.isPending}
              >
                Прикрепить
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
