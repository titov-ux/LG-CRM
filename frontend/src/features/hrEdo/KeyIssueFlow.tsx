/**
 * «Получить подпись»: SMS на номер из соглашения → выпуск ключа УНЭП ЛГ →
 * экран с отпечатком открытого ключа (копия уходит на почту).
 * Общий для портала и «Моих документов».
 */
import { useState } from 'react';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { EmployeeDocsApi, HrChallenge, HrSigningKey } from '@/api/hrEdo';
import { CodeStep } from './CodeStep';
import { DevSmsHint } from './DevSmsHint';
import { apiErrorMessage, groupFingerprint } from './statuses';

export function KeyIssueFlow({
  api,
  revoked,
  onIssued,
}: {
  api: EmployeeDocsApi;
  revoked?: boolean;
  onIssued: (key: HrSigningKey) => void;
}) {
  const [challenge, setChallenge] = useState<HrChallenge | null>(null);
  const [key, setKey] = useState<HrSigningKey | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      setChallenge(await api.keyOtp());
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось отправить код'));
    } finally {
      setBusy(false);
    }
  };

  if (key) {
    return (
      <Card className="border-emerald-500/30">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
            <CardTitle className="text-base">Электронная подпись выпущена</CardTitle>
          </div>
          <CardDescription>
            Отпечаток открытого ключа — по нему можно проверить, что документ подписан именно вашим ключом. Копия
            отправлена вам на почту.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="tnum break-words rounded-md border bg-muted/40 p-3 font-mono text-[12.5px] leading-6">
            {groupFingerprint(key.fingerprint)}
          </div>
          {key.isTest && (
            <p className="text-[11.5px] text-amber-700 dark:text-amber-400">
              Тестовый контур: подпись без КриптоПро, юридической силы не имеет.
            </p>
          )}
          <Button className="w-full" onClick={() => onIssued(key)}>
            Перейти к документам
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">{revoked ? 'Выпустите новую подпись' : 'Получите электронную подпись'}</CardTitle>
        </div>
        <CardDescription>
          {revoked
            ? 'Прежний ключ отозван. Новый выпускается после подтверждения кодом из SMS.'
            : 'Согласие на кадровый ЭДО зарегистрировано. Подтвердите номер телефона кодом из SMS — и сможете подписывать документы с телефона.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {challenge ? (
          <>
            <CodeStep
              challenge={challenge}
              submitLabel="Выпустить подпись"
              onResend={api.keyOtp}
              onSubmit={async (code) => {
                setKey(await api.keyIssue(challenge.challengeId, code));
              }}
            />
            <DevSmsHint />
          </>
        ) : (
          <Button className="w-full" onClick={() => void start()} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Получить подпись
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
