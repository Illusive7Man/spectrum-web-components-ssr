import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'dropzone',
  packages: ['dropzone', 'illustrated-message', 'link'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/dropzone/sp-dropzone.js'),
      import('@spectrum-web-components/illustrated-message/sp-illustrated-message.js'),
      import('@spectrum-web-components/link/sp-link.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Idle dropzone with an illustrated message and links</p>
      <sp-dropzone id="dropzone-idle" style="width:400px">
        <sp-illustrated-message heading="Drag and drop your file">
          <svg viewBox="0 0 150 103" width="150" height="103" aria-hidden="true">
            <rect x="35" y="10" width="80" height="83" rx="6" fill="none" stroke="currentColor" stroke-width="3"></rect>
            <path d="M50 40h50M50 55h50M50 70h30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path>
          </svg>
        </sp-illustrated-message>
        <div>
          <sp-link href="#dropzone-select">Select a file</sp-link>
          from your computer
        </div>
        <div>
          or
          <sp-link href="#dropzone-stock">search the stock library</sp-link>
        </div>
      </sp-dropzone>

      <p style=${CAP}>Plain text content</p>
      <sp-dropzone id="dropzone-plain" style="width:400px;height:96px">
        Drop files here to upload them
      </sp-dropzone>
    </div>
  `,
  notes: 'Idle state only (dragged and filled are false); the drag handlers are attached in the browser.',
  interactive: false,
};
