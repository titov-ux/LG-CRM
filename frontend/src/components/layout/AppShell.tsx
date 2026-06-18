import type { ReactNode } from 'react';
import { Sidebar, MobileSidebar } from './Sidebar';
import { Header } from './Header';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ProfileDialog } from '@/features/profile/ProfileDialog';

interface Props {
  title: string;
  children: ReactNode;
}

export function AppShell({ title, children }: Props) {
  return (
    <div className="flex h-screen bg-muted/20">
      <Sidebar />
      <MobileSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={title} />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
      <ProfileDialog />
    </div>
  );
}
