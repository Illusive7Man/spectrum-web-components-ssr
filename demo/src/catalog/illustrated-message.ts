import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'illustrated-message',
  packages: ['illustrated-message'],
  async load() {
    await import('@spectrum-web-components/illustrated-message/sp-illustrated-message.js');
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Heading and description as attributes</p>
      <sp-illustrated-message
        heading="No results found"
        description="Try adjusting your search or filter to find what you are looking for."
      >
        <svg viewBox="0 0 200 100" width="200" height="100" aria-hidden="true">
          <circle cx="85" cy="45" r="28" fill="none" stroke="currentColor" stroke-width="3"></circle>
          <path d="M106 66l30 26" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path>
        </svg>
      </sp-illustrated-message>

      <p style=${CAP}>Heading and description as slotted content</p>
      <sp-illustrated-message>
        <svg viewBox="0 0 200 100" width="200" height="100" aria-hidden="true">
          <rect x="60" y="15" width="80" height="70" rx="6" fill="none" stroke="currentColor" stroke-width="3"></rect>
          <path d="M75 40h50M75 55h35" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path>
        </svg>
        <h2 slot="heading">Your inbox is empty</h2>
        <div slot="description">New messages will show up here as soon as they arrive.</div>
      </sp-illustrated-message>
    </div>
  `,
  notes: 'Heading/description are rendered either from attributes or from named light-DOM slots.',
  interactive: false,
};
