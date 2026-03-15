import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ShowcaseTemplate } from '~/types/showcase-template';
import { CATEGORY_LABELS } from '~/types/showcase-template';

interface TemplatePreviewModalProps {
  template: ShowcaseTemplate | null;
  onClose: () => void;
}

export const TemplatePreviewModal: React.FC<TemplatePreviewModalProps> = ({ template, onClose }) => {
  const navigate = useNavigate();
  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);

  // Reset states when template changes
  useEffect(() => {
    setIframeLoading(true);
    setIframeError(false);
  }, [template]);

  // Ref-based iframe load listener (more reliable cross-browser than React onLoad)
  useEffect(() => {
    const iframe = iframeRef.current;

    if (!iframe || !template?.vercelUrl?.trim()) {
      return undefined;
    }

    const onLoad = () => {
      setIframeLoading(false);
    };

    iframe.addEventListener('load', onLoad);

    return () => {
      iframe.removeEventListener('load', onLoad);
    };
  }, [template]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (template) {
      document.body.style.overflow = 'hidden';

      return () => {
        document.body.style.overflow = '';
      };
    }

    return undefined;
  }, [template]);

  // Iframe load timeout — treat as error if iframe hasn't loaded in 15s
  useEffect(() => {
    if (!template?.vercelUrl?.trim() || iframeError || !iframeLoading) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setIframeError(true);
      setIframeLoading(false);
    }, 8_000);

    return () => {
      clearTimeout(timer);
    };
  }, [template, iframeLoading, iframeError]);

  // Focus trap and Escape key handling
  useEffect(() => {
    if (!template) {
      return undefined;
    }

    // Focus close button on open
    requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])',
        );

        if (focusableElements.length === 0) {
          return;
        }

        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable.focus();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [template, onClose]);

  // All hooks must be above the early return to satisfy Rules of Hooks
  const handleIframeError = useCallback(() => {
    setIframeError(true);
    setIframeLoading(false);
  }, []);

  if (!template) {
    return null;
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  const handlePreview = () => {
    window.open(template.vercelUrl, '_blank', 'noopener,noreferrer');
  };

  const handleUseTemplate = () => {
    const gitUrl = `https://github.com/${template.githubRepo}.git`;
    navigate(`/git?url=${encodeURIComponent(gitUrl)}`);
  };

  const renderPreview = () => {
    const vercelUrl = template.vercelUrl?.trim();

    if (vercelUrl) {
      if (iframeError) {
        return (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-4"
            style={{ backgroundColor: '#0a0a0a', minHeight: '600px' }}
          >
            <div className="i-ph:warning-circle text-4xl text-[#9ca3af]" />
            <p className="text-sm text-[#9ca3af]">This site cannot be previewed inline.</p>
            <a
              href={vercelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-[#3b82f6] hover:bg-[#2563eb] text-white"
            >
              Open in New Tab →
            </a>
          </div>
        );
      }

      return (
        <div className="relative w-full h-full" style={{ backgroundColor: '#0a0a0a', minHeight: '600px' }}>
          {iframeLoading && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: '#0a0a0a' }}>
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-[#9ca3af]">Loading preview…</p>
              </div>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={vercelUrl}
            title={`${template.name} live preview`}
            className="w-full h-full min-h-[600px] border-0"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            onError={handleIframeError}
          />
        </div>
      );
    }

    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-6"
        style={{ backgroundColor: '#0a0a0a', minHeight: '600px' }}
      >
        <div className={`${template.icon} text-5xl text-cyan-400`} />
        <p className="text-lg font-medium text-white">{template.name}</p>
        <p className="text-sm text-[#9ca3af]">Clone to customize this project</p>
      </div>
    );
  };

  const hasIframePreview = Boolean(template.vercelUrl?.trim()) && !iframeError;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }}
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-[90vw] max-h-[95vh] rounded-xl overflow-hidden flex flex-col"
        style={{ backgroundColor: '#1a1a1a', border: '1px solid #333333' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #333333' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className={`${template.icon} text-xl text-cyan-400 flex-shrink-0`} />
            <div className="min-w-0">
              <h2 id="template-modal-title" className="text-lg font-semibold text-white truncate">
                {template.name}
              </h2>
              <p className="text-sm text-[#9ca3af]">{CATEGORY_LABELS[template.category] || template.category}</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close preview"
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors flex-shrink-0 bg-[#2a2a2a] hover:bg-[#333333]"
          >
            <div className="i-ph:x text-lg text-[#9ca3af]" />
          </button>
        </div>

        {/* Preview Area */}
        <div className="flex-1 overflow-hidden relative" style={{ backgroundColor: '#0a0a0a' }}>
          {renderPreview()}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid #333333', backgroundColor: '#141414' }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-[#9ca3af] mr-2 hidden sm:block">{template.description}</p>
            {template.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-xs rounded-full text-[#9ca3af]"
                style={{ backgroundColor: '#2a2a2a' }}
              >
                {tag}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            {template.vercelUrl?.trim() && (
              <button
                onClick={handlePreview}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-[#2a2a2a] hover:bg-[#333333] text-white border border-[#333333]"
              >
                <div className={hasIframePreview ? 'i-ph:arrow-square-out text-base' : 'i-ph:eye text-base'} />
                {hasIframePreview ? 'Open in Browser' : 'Preview'}
              </button>
            )}
            <button
              onClick={handleUseTemplate}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-[#3b82f6] hover:bg-[#2563eb] text-white"
            >
              <div className="i-ph:code text-base" />
              Use Template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
