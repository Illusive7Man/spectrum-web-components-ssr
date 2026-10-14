import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'status-light',
  packages: ['status-light'],
  async load() {
    await import('@spectrum-web-components/status-light/sp-status-light.js');
  },
  render: () => html`
    <p style=${CAP}>Semantic variants</p>
    <div style=${ROW}>
      <sp-status-light variant="neutral">Draft</sp-status-light>
      <sp-status-light variant="positive">Approved</sp-status-light>
      <sp-status-light variant="negative">Rejected</sp-status-light>
      <sp-status-light variant="notice">Needs attention</sp-status-light>
      <sp-status-light variant="info">In review</sp-status-light>
    </div>

    <p style=${CAP}>Color variants</p>
    <div style=${ROW}>
      <sp-status-light variant="yellow">Yellow</sp-status-light>
      <sp-status-light variant="fuchsia">Fuchsia</sp-status-light>
      <sp-status-light variant="indigo">Indigo</sp-status-light>
      <sp-status-light variant="seafoam">Seafoam</sp-status-light>
      <sp-status-light variant="chartreuse">Chartreuse</sp-status-light>
      <sp-status-light variant="magenta">Magenta</sp-status-light>
      <sp-status-light variant="celery">Celery</sp-status-light>
      <sp-status-light variant="purple">Purple</sp-status-light>
      <sp-status-light variant="cyan">Cyan</sp-status-light>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-status-light size="s" variant="positive">Small</sp-status-light>
      <sp-status-light size="m" variant="positive">Medium</sp-status-light>
      <sp-status-light size="l" variant="positive">Large</sp-status-light>
      <sp-status-light size="xl" variant="positive">Extra large</sp-status-light>
    </div>

    <p style=${CAP}>Disabled</p>
    <div style=${ROW}>
      <sp-status-light variant="positive" disabled>Disabled</sp-status-light>
    </div>
  `,
  notes: 'Stateless; aria-disabled is applied in updated() when disabled.',
  interactive: false,
};
