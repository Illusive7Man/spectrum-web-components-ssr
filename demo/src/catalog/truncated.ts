import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP} from './_shared.ts';

const BOX =
  'border:1px solid var(--spectrum-gray-300);padding:8px;overflow:hidden;box-sizing:border-box';

export const entry: CatalogEntry = {
  name: 'truncated',
  packages: ['truncated', 'overlay', 'tooltip'],
  async load() {
    await import('@spectrum-web-components/truncated/sp-truncated.js');
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Text that overflows its container (200px wide)</p>
      <div style=${`${BOX};width:200px`}>
        <sp-truncated>
          This is a very long sentence that should be truncated when there is not enough space
          to display it fully.
        </sp-truncated>
      </div>

      <p style=${CAP}>Text that fits (no tooltip is needed)</p>
      <div style=${`${BOX};width:320px`}>
        <sp-truncated>Short text.</sp-truncated>
      </div>

      <p style=${CAP}>Mixed inline content</p>
      <div style=${`${BOX};width:250px`}>
        <sp-truncated>
          This is a <strong>very long</strong> sentence with <em>formatted text</em> that should
          be truncated.
        </sp-truncated>
      </div>

      <p style=${CAP}>A long word without spaces</p>
      <div style=${`${BOX};width:150px`}>
        <sp-truncated>Supercalifragilisticexpialidocious_file_name_without_spaces.txt</sp-truncated>
      </div>
    </div>
  `,
  notes:
    'Whether the text overflows is only known after layout (offsetWidth vs clientWidth, re-checked by a ResizeObserver), so the overflow state and its tooltip are decided in the browser. The server output is the plain text with the tooltip closed.',
  interactive: false,
};
