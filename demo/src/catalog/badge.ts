import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {ROW, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'badge',
  packages: ['badge', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/badge/sp-badge.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-info.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-checkmark-circle.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-alert.js'),
    ]);
  },
  render: () => html`
    <p style=${CAP}>Semantic variants</p>
    <div style=${ROW}>
      <sp-badge variant="accent">Accent</sp-badge>
      <sp-badge variant="informative">Informative</sp-badge>
      <sp-badge variant="neutral">Neutral</sp-badge>
      <sp-badge variant="positive">Positive</sp-badge>
      <sp-badge variant="notice">Notice</sp-badge>
      <sp-badge variant="negative">Negative</sp-badge>
    </div>

    <p style=${CAP}>Color variants</p>
    <div style=${ROW}>
      <sp-badge variant="fuchsia">Fuchsia</sp-badge>
      <sp-badge variant="indigo">Indigo</sp-badge>
      <sp-badge variant="magenta">Magenta</sp-badge>
      <sp-badge variant="purple">Purple</sp-badge>
      <sp-badge variant="seafoam">Seafoam</sp-badge>
      <sp-badge variant="yellow">Yellow</sp-badge>
      <sp-badge variant="gray">Gray</sp-badge>
      <sp-badge variant="celery">Celery</sp-badge>
    </div>

    <p style=${CAP}>Sizes</p>
    <div style=${ROW}>
      <sp-badge size="s" variant="informative">Small</sp-badge>
      <sp-badge size="m" variant="informative">Medium</sp-badge>
      <sp-badge size="l" variant="informative">Large</sp-badge>
      <sp-badge size="xl" variant="informative">Extra large</sp-badge>
    </div>

    <p style=${CAP}>With an icon</p>
    <div style=${ROW}>
      <sp-badge variant="informative">
        <sp-icon-info slot="icon"></sp-icon-info>
        Informative
      </sp-badge>
      <sp-badge variant="positive">
        <sp-icon-checkmark-circle slot="icon"></sp-icon-checkmark-circle>
        Approved
      </sp-badge>
      <sp-badge variant="negative">
        <sp-icon-alert slot="icon"></sp-icon-alert>
        Rejected
      </sp-badge>
      <sp-badge variant="notice">
        <sp-icon-alert slot="icon"></sp-icon-alert>
      </sp-badge>
    </div>
  `,
  notes: 'Icon-only badge relies on the slot-presence observer to drop the label gap.',
  interactive: false,
};
