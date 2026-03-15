import { json, type MetaFunction } from '@remix-run/node';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import { MigrationBanner } from '~/components/chat/MigrationBanner.client';
import { UpdateBanner } from '~/components/ui/UpdateBanner';

export const meta: MetaFunction = () => {
  return [
    { title: 'Devonz' },
    { name: 'description', content: 'Talk with Devonz, an AI-powered development assistant' },
    { property: 'og:title', content: 'Devonz' },
    { property: 'og:description', content: 'Talk with Devonz, an AI-powered development assistant' },
    { property: 'og:type', content: 'website' },
    { property: 'og:image', content: '/logo-dark-styled.png' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: 'Devonz' },
    { name: 'twitter:description', content: 'Talk with Devonz, an AI-powered development assistant' },
  ];
};

export const loader = () => json({});

/**
 * Landing page component for Devonz
 * Note: Settings functionality should ONLY be accessed through the sidebar menu.
 * Do not add settings button/panel to this landing page as it was intentionally removed
 * to keep the UI clean and consistent with the design system.
 */
export default function Index() {
  return (
    <main
      id="main-content"
      className="flex flex-col h-full w-full overflow-hidden bg-devonz-elements-background-depth-1"
    >
      <ClientOnly>{() => <MigrationBanner />}</ClientOnly>
      <ClientOnly>{() => <UpdateBanner />}</ClientOnly>
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </main>
  );
}
