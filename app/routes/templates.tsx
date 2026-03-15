import { Suspense } from 'react';
import { type MetaFunction } from 'react-router';
import { Header } from '~/components/header/Header';
import { clientLazy } from '~/utils/react';

const TemplatesGallery = clientLazy(() => import('~/components/templates/TemplatesGallery.client'));

// ── Route metadata ──────────────────────────────────────────────────────────

export const meta: MetaFunction = () => {
  return [
    { title: 'Templates | Devonz' },
    { name: 'description', content: 'Browse curated website templates for Devonz' },
  ];
};

export const loader = () => Response.json({});

// ── Route export ────────────────────────────────────────────────────────────

export default function TemplatesRoute() {
  return (
    <main className="flex flex-col h-full w-full" style={{ backgroundColor: '#0a0a0a' }}>
      <Header />
      <Suspense fallback={null}>
        <TemplatesGallery />
      </Suspense>
    </main>
  );
}
