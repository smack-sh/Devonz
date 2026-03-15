import { lazy, Suspense } from 'react';
import { type MetaFunction } from 'react-router';
import { BaseChat } from '~/components/chat/BaseChat';
import { Header } from '~/components/header/Header';
import { clientLazy } from '~/utils/react';

const Chat = clientLazy(() => import('~/components/chat/Chat.client').then((m) => ({ default: m.Chat })));
const MigrationBanner = clientLazy(() =>
  import('~/components/chat/MigrationBanner.client').then((m) => ({ default: m.MigrationBanner })),
);
const UpdateBanner = lazy(() => import('~/components/ui/UpdateBanner').then((m) => ({ default: m.UpdateBanner })));

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

export const loader = () => Response.json({});

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
      <Suspense fallback={null}>
        <MigrationBanner />
      </Suspense>
      <Suspense fallback={null}>
        <UpdateBanner />
      </Suspense>
      <Header />
      <Suspense fallback={<BaseChat />}>
        <Chat />
      </Suspense>
    </main>
  );
}
