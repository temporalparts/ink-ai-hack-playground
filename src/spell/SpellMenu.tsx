// Spell menu overlay component
//
// Displays entry buttons (no games) plus a text input when an element
// is double-clicked, allowing quick replacement or a typed spell.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SpellIntent, SpellAction } from './SpellIntent';
import type { Offset } from '../types';
import { computeSpellGridLayout } from './spellGridLayout';

export interface SpellMenuProps {
  intent: SpellIntent | null;
  onAction: (action: SpellAction, value?: string) => void;
  canvasToScreen: (point: Offset) => Offset;
}

const MENU_OFFSET_Y = -60;

export function SpellMenu({
  intent,
  onAction,
  canvasToScreen,
}: SpellMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');

  // Reset text when intent changes
  useEffect(() => {
    if (intent) {
      setText('');
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [intent]);

  useEffect(() => {
    if (!intent) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onAction('dismiss');
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onAction('dismiss');
      }
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [intent, onAction]);

  const handleSelectEntry = useCallback((e: React.MouseEvent, entryId: string) => {
    e.stopPropagation();
    onAction('select', entryId);
  }, [onAction]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (trimmed) {
      onAction('cast', trimmed);
    }
  }, [text, onAction]);

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onAction('dismiss');
  }, [onAction]);

  const entries = intent?.entries;
  const layout = useMemo(
    () => entries ? computeSpellGridLayout(entries) : null,
    [entries],
  );

  if (!intent || !layout || intent.entries.length === 0) {
    return null;
  }

  const anchorScreen = canvasToScreen(intent.anchorPoint);
  const menuX = anchorScreen.x;
  const menuY = anchorScreen.y + MENU_OFFSET_Y;

  return (
    <div
      ref={menuRef}
      style={{
        position: 'absolute',
        left: menuX,
        top: menuY,
        transform: 'translateX(-50%)',
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 12px rgba(0, 0, 0, 0.15)',
          border: '1px solid #e0e0e0',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '6px 12px',
            fontSize: '11px',
            color: '#666',
            borderBottom: '1px solid #e0e0e0',
            width: '100%',
            textAlign: 'center',
            backgroundColor: '#f8f8f8',
          }}
        >
          Cast spell...
        </div>

        {/* Body: entry buttons on left, text input on right */}
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          {/* Entry buttons grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: layout.gridTemplateColumns,
            gridTemplateRows: 'auto auto',
          }}>
            {/* Row 1: category labels spanning their groups */}
            {layout.groupSpans.map((span, gi) => (
              <div
                key={span.category}
                style={{
                  gridRow: 1,
                  gridColumn: `${span.start} / ${span.end}`,
                  fontSize: '9px',
                  color: '#999',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  textAlign: 'center',
                  padding: '3px 4px',
                  lineHeight: 1,
                  borderBottom: '1px solid #e0e0e0',
                  ...(gi > 0 ? { borderLeft: '1px solid #d0d0d0' } : {}),
                }}
              >
                {span.label}
              </div>
            ))}

            {/* Row 2: entry buttons */}
            {intent.entries.map((entry, index) => (
              <button
                key={entry.id}
                onClick={(e) => handleSelectEntry(e, entry.id)}
                style={{
                  gridRow: 2,
                  gridColumn: layout.entryColumns[index],
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '10px 12px',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  color: '#333',
                  gap: '4px',
                  transition: 'background-color 0.15s',
                  minWidth: '56px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0f7ff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                title={entry.label}
              >
                <entry.Icon />
                <span style={{ fontSize: '10px' }}>{entry.label}</span>
              </button>
            ))}

            {/* Separator columns (row 2) */}
            {layout.separators.map((sep) => (
              <div
                key={`sep-${sep.column}`}
                style={{
                  gridRow: 2,
                  gridColumn: sep.column,
                  backgroundColor: sep.type === 'group-sep' ? '#d0d0d0' : '#e0e0e0',
                }}
              />
            ))}
          </div>

          {/* Divider between buttons and text input */}
          <div style={{ width: '1px', backgroundColor: '#d0d0d0' }} />

          {/* Text input section */}
          <form
            onSubmit={handleSubmit}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              padding: '8px',
              gap: '6px',
              justifyContent: 'center',
            }}
          >
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                // Auto-resize height up to max
                e.target.style.height = 'auto';
                const maxHeight = parseFloat(getComputedStyle(e.target).lineHeight) * 10 + 12; // 10 lines + padding
                e.target.style.height = Math.min(e.target.scrollHeight, maxHeight) + 'px';
                e.target.style.overflowY = e.target.scrollHeight > maxHeight ? 'auto' : 'hidden';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (text.trim()) {
                    onAction('cast', text.trim());
                  }
                }
              }}
              placeholder="Describe the transformation..."
              rows={2}
              style={{
                minWidth: '400px',
                padding: '6px 10px',
                fontSize: '13px',
                border: '1px solid #d0d0d0',
                borderRadius: '4px',
                outline: 'none',
                resize: 'none',
                overflowY: 'hidden',
                fontFamily: 'inherit',
                lineHeight: '1.4',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#0066ff';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#d0d0d0';
              }}
            />
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleDismiss}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  border: '1px solid #d0d0d0',
                  borderRadius: '4px',
                  background: 'none',
                  cursor: 'pointer',
                  color: '#666',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!text.trim()}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  border: 'none',
                  borderRadius: '4px',
                  backgroundColor: text.trim() ? '#0066ff' : '#ccc',
                  color: 'white',
                  cursor: text.trim() ? 'pointer' : 'default',
                  transition: 'background-color 0.15s',
                }}
              >
                Cast
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Tooltip arrow */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: '-8px',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '8px solid transparent',
          borderRight: '8px solid transparent',
          borderTop: '8px solid white',
          filter: 'drop-shadow(0 1px 1px rgba(0, 0, 0, 0.1))',
        }}
      />
    </div>
  );
}

export default SpellMenu;
