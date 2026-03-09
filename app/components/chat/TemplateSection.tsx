import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@remix-run/react';
import type { ShowcaseTemplate } from '~/types/showcase-template';
import { CATEGORY_LABELS, type TemplateCategory } from '~/types/showcase-template';
import { loadShowcaseTemplates } from '~/utils/showcase-templates';
import { TEMPLATE_CATEGORY_BADGE_COLORS, TEMPLATE_UI_COLORS } from '~/components/templates/templateTheme';

function getCategoryBadge(category: TemplateCategory) {
  const colors = TEMPLATE_CATEGORY_BADGE_COLORS[category] ?? {
    text: TEMPLATE_UI_COLORS.textMuted,
    bg: 'rgba(156,163,175,0.12)',
  };
  const label = CATEGORY_LABELS[category] ?? category;

  return { colors, label };
}

const CARD_WIDTH = 180;
const GAP = 12;

/** Pixels per second for the auto-scroll */
const SCROLL_SPEED_PX_PER_SEC = 15;

export const TemplateSection: React.FC = () => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<ShowcaseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadShowcaseTemplates()
      .then((data) => {
        const withUrl = data.filter((t) => t.vercelUrl?.trim());
        const withoutUrl = data.filter((t) => !t.vercelUrl?.trim());

        setTemplates([...withUrl, ...withoutUrl]);
      })
      .catch(() => {
        setTemplates([]);
      })
      .finally(() => setLoading(false));
  }, []);

  /* Total width of one set of cards (used for animation distance) */
  const setWidth = useMemo(() => {
    if (templates.length === 0) {
      return 0;
    }

    return templates.length * (CARD_WIDTH + GAP);
  }, [templates]);

  /* Duration to traverse one full set at the chosen speed */
  const durationSec = setWidth > 0 ? setWidth / SCROLL_SPEED_PX_PER_SEC : 0;

  if (loading) {
    return (
      <div className="w-full max-w-chat mx-auto mt-4 px-4">
        <div className="flex items-center justify-center py-4">
          <div className="i-svg-spinners:90-ring-with-bg text-lg text-devonz-elements-loader-progress" />
        </div>
      </div>
    );
  }

  if (templates.length === 0) {
    return null;
  }

  /* Render two copies so CSS translateX can loop seamlessly */
  const displayItems = [...templates, ...templates];

  return (
    <div className="w-full max-w-chat mx-auto mt-4 px-4" style={{ minWidth: 0 }}>
      {/* Carousel viewport — clips overflow */}
      <div
        style={{ overflow: 'hidden' }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        {/* Sliding track — two copies side by side, translated via CSS */}
        <div
          ref={trackRef}
          className="flex flex-nowrap pb-2"
          style={{
            gap: GAP,
            width: 'max-content',
            animation: `template-marquee ${durationSec}s linear infinite`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        >
          {displayItems.map((template, idx) => {
            const { colors, label } = getCategoryBadge(template.category);

            return (
              <button
                key={`${template.id}-${idx}`}
                type="button"
                onClick={() => navigate(`/templates?selected=${template.id}`)}
                className="rounded-lg overflow-hidden border border-[#333333] hover:border-[#555555] transition-all duration-200 cursor-pointer group focus:outline-none focus:ring-2 focus:ring-[#555555]"
                style={{
                  flex: `0 0 ${CARD_WIDTH}px`,
                  height: 112,
                  backgroundColor: TEMPLATE_UI_COLORS.cardBg,
                  position: 'relative',
                }}
                aria-label={`Open ${template.name} template`}
              >
                {/* Screenshot thumbnail */}
                <img
                  src={`/screenshots/${template.id}.png`}
                  alt={`${template.name} preview`}
                  loading="lazy"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  onError={(e) => {
                    const target = e.currentTarget;
                    target.style.display = 'none';

                    const fallback = target.nextElementSibling as HTMLElement | null;

                    if (fallback) {
                      fallback.style.display = 'flex';
                    }
                  }}
                />

                {/* Fallback icon (hidden by default) */}
                <div
                  className="items-center justify-center text-3xl"
                  style={{
                    display: 'none',
                    position: 'absolute',
                    inset: 0,
                    background: `linear-gradient(135deg, ${TEMPLATE_UI_COLORS.cardBg} 0%, ${TEMPLATE_UI_COLORS.pageBg} 100%)`,
                  }}
                  aria-hidden="true"
                >
                  <span>{template.icon}</span>
                </div>

                {/* Category badge — top-right */}
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    color: colors.text,
                    backgroundColor: colors.bg,
                    backdropFilter: 'blur(4px)',
                    zIndex: 2,
                  }}
                >
                  {label}
                </span>

                {/* Name overlay — bottom */}
                <div
                  className="px-2 py-1.5"
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    width: '100%',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
                    zIndex: 2,
                  }}
                >
                  <span className="text-xs font-medium text-white truncate block">{template.name}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Keyframes + scrollbar-hide */}
      <style>{`
        @keyframes template-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-${setWidth}px); }
        }
        .template-carousel::-webkit-scrollbar { display: none; }
      `}</style>

      {/* View all button — below carousel */}
      <div className="flex justify-center mt-3">
        <Link
          to="/templates"
          prefetch="intent"
          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all duration-200 flex items-center gap-1.5 group border border-[#333333] hover:border-[#555555] hover:bg-[#2a2a2a] no-underline"
          style={{ color: TEMPLATE_UI_COLORS.textMuted, backgroundColor: TEMPLATE_UI_COLORS.cardBg }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = TEMPLATE_UI_COLORS.textMuted;
          }}
        >
          View All Templates
          <div className="i-ph:arrow-right text-xs transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
};
