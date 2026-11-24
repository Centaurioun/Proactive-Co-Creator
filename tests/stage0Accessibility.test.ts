import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Stage 0 (S0.7) — Verified P1 Accessibility Regressions', () => {
  it('S0.7-FIX-1: BeliefGraph Table View entity and relationship rows are keyboard-operable (tabIndex=0 + Enter/Space)', () => {
    const filePath = path.resolve(process.cwd(), 'components/BeliefGraph.tsx');
    const src = fs.readFileSync(filePath, 'utf8');
    const tableStart = src.indexOf('{displayMode === \'table\' ? (');
    assert.ok(tableStart !== -1, 'Expected Table View section in BeliefGraph.tsx');
    const tableEnd = src.indexOf(') : (', tableStart);
    const tableSrc = src.slice(tableStart, tableEnd);

    const tabIndexMatches = tableSrc.match(/tabIndex=\{0\}/g) ?? [];
    assert.ok(
      tabIndexMatches.length >= 2,
      `Expected both entity and relationship Table View rows to have tabIndex={0}, found ${tabIndexMatches.length}`
    );
    const keyDownMatches = tableSrc.match(/onKeyDown=\{/g) ?? [];
    assert.ok(
      keyDownMatches.length >= 2,
      `Expected both entity and relationship Table View rows to handle onKeyDown (Enter/Space), found ${keyDownMatches.length}`
    );
    assert.ok(
      tableSrc.includes("e.key === 'Enter'") && tableSrc.includes("e.key === ' '"),
      'Expected Table View rows to activate on Enter and Space'
    );
  });

  it('S0.7-FIX-2a: OutputGallery Image full preview dialog moves focus inside on open, traps Tab, and restores opener focus on close', () => {
    const filePath = path.resolve(process.cwd(), 'components/OutputGallery.tsx');
    const src = fs.readFileSync(filePath, 'utf8');
    assert.ok(
      src.includes('previousFocusRef') || src.includes('openerRef'),
      'Expected OutputGallery image lightbox to track previously focused opener element'
    );
    assert.ok(
      src.includes('lightboxCloseRef') || src.includes('closePreviewRef'),
      'Expected OutputGallery image lightbox to focus an interior control on open'
    );
    assert.ok(
      src.includes("event.key === 'Tab'"),
      'Expected OutputGallery image lightbox to trap Tab navigation while open'
    );
  });

  it('S0.7-FIX-2b: InfoModal moves focus inside on open, traps Tab, and restores opener focus on close', () => {
    const filePath = path.resolve(process.cwd(), 'components/InfoModal.tsx');
    const src = fs.readFileSync(filePath, 'utf8');
    assert.ok(
      src.includes('previousFocusRef') || src.includes('openerRef'),
      'Expected InfoModal to track previously focused opener element'
    );
    assert.ok(
      src.includes('closeButtonRef'),
      'Expected InfoModal to focus close button inside dialog on open'
    );
    assert.ok(
      src.includes("event.key === 'Tab'"),
      'Expected InfoModal to trap Tab navigation while open'
    );
  });
});
