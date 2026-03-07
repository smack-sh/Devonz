import { useState } from 'react';
import type { ShowcaseTemplate } from '~/types/showcase-template';

interface TemplateCardProps {
  template: ShowcaseTemplate;
  onClick: (template: ShowcaseTemplate) => void;
}

const CATEGORY_BADGE_COLORS: Record<string, { text: string; bg: string }> = {
  'landing-page': { text: '#22d3ee', bg: 'rgba(34, 211, 238, 0.12)' },
  portfolio: { text: '#818cf8', bg: 'rgba(129, 140, 248, 0.12)' },
  'online-store': { text: '#4ade80', bg: 'rgba(74, 222, 128, 0.12)' },
  dashboard: { text: '#fb923c', bg: 'rgba(251, 146, 60, 0.12)' },
  saas: { text: '#c084fc', bg: 'rgba(192, 132, 252, 0.12)' },
  'ai-app': { text: '#f472b6', bg: 'rgba(244, 114, 182, 0.12)' },
};

const CATEGORY_LABELS: Record<string, string> = {
  'landing-page': 'Landing Page',
  portfolio: 'Portfolio',
  'online-store': 'Online Store',
  dashboard: 'Dashboard',
  saas: 'SaaS',
  'ai-app': 'AI App',
};

export function TemplateCard({ template, onClick }: TemplateCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const badge = CATEGORY_BADGE_COLORS[template.category] ?? CATEGORY_BADGE_COLORS['landing-page'];
  const label = CATEGORY_LABELS[template.category] ?? template.category;
  const screenshotSrc = template.screenshotUrl ?? `/screenshots/${template.id}.png`;
  const showScreenshot = !imgFailed;

  return (
    <button
      type="button"
      onClick={() => onClick(template)}
      className="relative overflow-hidden rounded-xl text-left w-full group outline-none focus-visible:ring-2 focus-visible:ring-[#818cf8]"
      style={{
        backgroundColor: '#1a1a1a',
        border: '1px solid #2a2a2a',
        transition: 'transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px) scale(1.015)';
        e.currentTarget.style.borderColor = badge.text + '55';
        e.currentTarget.style.boxShadow = `0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px ${badge.text}22`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0) scale(1)';
        e.currentTarget.style.borderColor = '#2a2a2a';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Thumbnail area */}
      <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
        {showScreenshot ? (
          <img
            src={screenshotSrc}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, #1a1a1a 0%, ${badge.text}18 100%)` }}
          >
            <div className={`${template.icon} text-4xl`} style={{ color: badge.text }} />
          </div>
        )}

        {/* Gradient overlay for text readability */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to top, rgba(10,10,10,0.95) 0%, rgba(10,10,10,0.4) 50%, transparent 100%)',
          }}
        />

        {/* Category badge — top right */}
        <span
          className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full leading-tight"
          style={{
            color: badge.text,
            backgroundColor: badge.bg,
            backdropFilter: 'blur(6px)',
            border: `1px solid ${badge.text}33`,
          }}
        >
          {label}
        </span>

        {/* Template name — bottom of thumbnail */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-2.5 pt-4">
          <p className="text-sm font-semibold text-white truncate drop-shadow-md">{template.name}</p>
        </div>
      </div>
    </button>
  );
}
