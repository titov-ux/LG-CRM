import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useUIStore } from '@/stores/ui';

export function SettingsPage() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);

  return (
    <div className="flex-1 overflow-auto px-6 pb-6 pt-5">
      <Card>
        <CardHeader>
          <CardTitle>Настройки</CardTitle>
          <CardDescription>Параметры профиля и интерфейса</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Свернуть боковую панель</Label>
              <p className="text-xs text-muted-foreground">Полезно на узких экранах.</p>
            </div>
            <Switch checked={collapsed} onCheckedChange={toggle} />
          </div>
          <Separator />
          <div className="text-xs text-muted-foreground">
            2FA, языки, тёмная тема — появятся на этапе 2.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
