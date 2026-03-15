import { Suspense } from 'react';
import type { LoaderFunctionArgs } from 'react-router';
import { type MetaFunction } from 'react-router';
import { BaseChat } from '~/components/chat/BaseChat';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { clientLazy } from '~/utils/react';

const GitUrlImport = clientLazy(() =>
  import('~/components/git/GitUrlImport.client').then((m) => ({ default: m.GitUrlImport })),
);

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

export async function loader(args: LoaderFunctionArgs) {
  return Response.json({ url: args.params.url });
}

export default function Index() {
  return (
    <main className="flex flex-col h-full w-full bg-devonz-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <Suspense fallback={<BaseChat />}>
        <GitUrlImport />
      </Suspense>
    </main>
  );
}
