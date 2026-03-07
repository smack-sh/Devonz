import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogDescription, DialogRoot } from './Dialog';
import { IconButton } from './IconButton';
import type { DesignScheme } from '~/types/design-scheme';
import { defaultDesignScheme, designFeatures, designFonts, paletteRoles } from '~/types/design-scheme';

export interface ColorSchemeDialogProps {
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
}

export const ColorSchemeDialog: React.FC<ColorSchemeDialogProps> = ({ setDesignScheme, designScheme }) => {
  const [palette, setPalette] = useState<{ [key: string]: string }>(() => {
    if (designScheme?.palette) {
      return { ...defaultDesignScheme.palette, ...designScheme.palette };
    }

    return defaultDesignScheme.palette;
  });

  const [features, setFeatures] = useState<string[]>(designScheme?.features || defaultDesignScheme.features);
  const [font, setFont] = useState<string[]>(designScheme?.font || defaultDesignScheme.font);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'colors' | 'typography' | 'features'>('colors');

  useEffect(() => {
    if (designScheme) {
      setPalette(() => ({ ...defaultDesignScheme.palette, ...designScheme.palette }));
      setFeatures(designScheme.features || defaultDesignScheme.features);
      setFont(designScheme.font || defaultDesignScheme.font);
    } else {
      setPalette(defaultDesignScheme.palette);
      setFeatures(defaultDesignScheme.features);
      setFont(defaultDesignScheme.font);
    }
  }, [designScheme]);

  const handleColorChange = (role: string, value: string) => {
    setPalette((prev) => ({ ...prev, [role]: value }));
  };

  const handleFeatureToggle = (key: string) => {
    setFeatures((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));
  };

  const handleFontToggle = (key: string) => {
    setFont((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));
  };

  const handleSave = () => {
    setDesignScheme?.({ palette, features, font });
    setIsDialogOpen(false);
  };

  const handleReset = () => {
    setPalette(defaultDesignScheme.palette);
    setFeatures(defaultDesignScheme.features);
    setFont(defaultDesignScheme.font);
  };

  const renderColorSection = () => (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-[#e6edf3] flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[#8badd4]"></div>
          Color Palette
        </h3>
        <button
          onClick={handleReset}
          className="text-xs bg-transparent hover:bg-[#1a2332] text-[#8b949e] hover:text-[#e6edf3] px-2 py-1 rounded-md flex items-center gap-1.5 transition-all border border-transparent hover:border-white/8"
        >
          <span className="i-ph:arrow-clockwise text-xs" />
          Reset
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
        {paletteRoles.map((role) => (
          <div
            key={role.key}
            className="group flex items-center gap-3 p-3 rounded-lg bg-[#1a2332]/50 hover:bg-[#1a2332] border border-white/[0.04] hover:border-white/8 transition-all"
          >
            <div className="relative flex-shrink-0">
              <div
                className="w-9 h-9 rounded-lg shadow-sm cursor-pointer transition-all hover:scale-110 ring-1 ring-white/10 hover:ring-[#4d6a8f]"
                style={{ backgroundColor: palette[role.key] }}
                onClick={() => document.getElementById(`color-input-${role.key}`)?.click()}
                role="button"
                tabIndex={0}
                aria-label={`Change ${role.label} color`}
              />
              <input
                id={`color-input-${role.key}`}
                type="color"
                value={palette[role.key]}
                onChange={(e) => handleColorChange(role.key, e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                tabIndex={-1}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-[#e6edf3]">{role.label}</div>
              <div className="text-[10px] text-[#8b949e] line-clamp-1">{role.description}</div>
              <div className="text-[10px] text-[#8b949e]/60 font-mono mt-0.5">{palette[role.key]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderTypographySection = () => (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-[#e6edf3] flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-[#8badd4]"></div>
        Typography
      </h3>

      <div className="grid grid-cols-3 gap-2 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
        {designFonts.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => handleFontToggle(f.key)}
            className={`group p-3 rounded-lg border transition-all focus:outline-none ${
              font.includes(f.key)
                ? 'bg-[#1e3a5f]/40 border-[#4d6a8f] text-[#8badd4]'
                : 'bg-[#1a2332]/50 border-white/[0.04] hover:border-white/8 hover:bg-[#1a2332] text-[#8b949e]'
            }`}
          >
            <div className="text-center space-y-1.5">
              <div
                className={`text-lg font-medium transition-colors ${
                  font.includes(f.key) ? 'text-[#8badd4]' : 'text-[#e6edf3]'
                }`}
                style={{ fontFamily: f.key }}
              >
                {f.preview}
              </div>
              <div className="text-[10px] font-medium">{f.label}</div>
              {font.includes(f.key) && (
                <div className="w-4 h-4 mx-auto bg-[#4d6a8f] rounded-full flex items-center justify-center">
                  <span className="i-ph:check text-white text-[10px]" />
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  const renderFeaturesSection = () => (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-[#e6edf3] flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-[#8badd4]"></div>
        Design Features
      </h3>

      <div className="grid grid-cols-2 gap-2 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
        {designFeatures.map((f) => {
          const isSelected = features.includes(f.key);

          return (
            <button
              key={f.key}
              type="button"
              onClick={() => handleFeatureToggle(f.key)}
              className={`group relative w-full p-4 text-sm font-medium transition-all rounded-lg border ${
                isSelected
                  ? 'bg-[#1e3a5f]/40 border-[#4d6a8f] text-[#8badd4]'
                  : 'bg-[#1a2332]/50 border-white/[0.04] hover:border-white/8 hover:bg-[#1a2332] text-[#8b949e]'
              }`}
              style={{
                ...(f.key === 'gradient' &&
                  isSelected && {
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    borderColor: '#667eea',
                    color: 'white',
                  }),
              }}
            >
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/5">
                  {f.key === 'rounded' && (
                    <div
                      className={`w-5 h-5 bg-current transition-all ${isSelected ? 'rounded-full' : 'rounded'} opacity-80`}
                    />
                  )}
                  {f.key === 'border' && (
                    <div
                      className={`w-5 h-5 rounded transition-all ${
                        isSelected ? 'border-2 border-current opacity-90' : 'border border-current opacity-60'
                      }`}
                    />
                  )}
                  {f.key === 'gradient' && (
                    <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-400 via-pink-400 to-indigo-400 opacity-90" />
                  )}
                  {f.key === 'shadow' && (
                    <div className="relative">
                      <div className={`w-5 h-5 bg-current rounded opacity-${isSelected ? '90' : '60'}`} />
                      <div
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-current rounded opacity-${isSelected ? '40' : '25'}`}
                      />
                    </div>
                  )}
                  {f.key === 'frosted-glass' && (
                    <div className="relative">
                      <div className="w-5 h-5 rounded backdrop-blur-sm bg-white/20 border border-white/30 opacity-80" />
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <div className="text-xs font-medium">{f.label}</div>
                  {isSelected && <div className="mt-1 w-6 h-0.5 bg-current rounded-full mx-auto opacity-60" />}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div>
      <IconButton title="Design Palette" className="transition-all" onClick={() => setIsDialogOpen(!isDialogOpen)}>
        <div className="i-ph:palette text-xl"></div>
      </IconButton>

      <DialogRoot open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <Dialog className="!bg-[#0b0d13] !border-white/8 !shadow-xl !shadow-black/50 !rounded-xl !w-[560px]">
          <div className="flex flex-col overflow-hidden max-h-[85vh]">
            {/* Header */}
            <div className="px-5 pt-5 pb-3">
              <DialogTitle className="!text-lg font-semibold text-[#e6edf3]">
                <span className="i-ph:palette-duotone text-[#8badd4] mr-2" />
                Design Palette
              </DialogTitle>
              <DialogDescription className="text-[#8b949e] text-xs mt-1">
                Customize colors, typography, and design features for AI-generated designs.
              </DialogDescription>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/8 bg-[#0b0d13]">
              {(
                [
                  { key: 'colors', label: 'Colors', icon: 'i-ph:palette' },
                  { key: 'typography', label: 'Typography', icon: 'i-ph:text-aa' },
                  { key: 'features', label: 'Features', icon: 'i-ph:magic-wand' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveSection(tab.key)}
                  className={`flex-1 px-4 py-2.5 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                    activeSection === tab.key
                      ? 'bg-[#1e3a5f]/40 text-[#8badd4] border-b-2 border-[#4d6a8f]'
                      : 'bg-[#0b0d13] text-[#8b949e] hover:bg-[#1a2332] hover:text-[#e6edf3]'
                  }`}
                >
                  <span className={`${tab.icon}`} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto min-h-[320px] max-h-[440px] p-4 custom-scrollbar">
              {activeSection === 'colors' && renderColorSection()}
              {activeSection === 'typography' && renderTypographySection()}
              {activeSection === 'features' && renderFeaturesSection()}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-white/[0.04] bg-[#0b0d13] flex justify-between items-center">
              <div className="text-xs text-[#8b949e]">
                {Object.keys(palette).length} colors • {font.length} fonts • {features.length} features
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setIsDialogOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium text-[#8b949e] hover:text-[#e6edf3] bg-[#1a2332] border border-white/8 rounded-lg transition-all hover:bg-[#1e3a5f]/30"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-3 py-1.5 text-xs font-medium text-[#8badd4] bg-[#1e3a5f]/40 border border-[#4d6a8f]/50 rounded-lg transition-all hover:bg-[#1e3a5f]/60"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </Dialog>
      </DialogRoot>

      <style>{`
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(139, 173, 212, 0.2) transparent;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(139, 173, 212, 0.2);
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(139, 173, 212, 0.35);
        }
        .line-clamp-1 {
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
};
