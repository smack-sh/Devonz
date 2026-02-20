import type { LoaderFunctionArgs } from '@remix-run/node';
import { json, type MetaFunction } from '@remix-run/node';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { GitUrlImport } from '~/components/git/GitUrlImport.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';

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
  return json({ url: args.params.url });
}

export default function Index() {
  return (
    <main className="flex flex-col h-full w-full bg-devonz-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <GitUrlImport />}</ClientOnly>
    </main>
  );
}
