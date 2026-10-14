import {html} from 'lit';
import type {CatalogEntry} from './types.ts';
import {COL, CAP, sampleImage} from './_shared.ts';

export const entry: CatalogEntry = {
  name: 'tags',
  packages: ['tags', 'avatar', 'icons-workflow'],
  async load() {
    await Promise.all([
      import('@spectrum-web-components/tags/sp-tags.js'),
      import('@spectrum-web-components/tags/sp-tag.js'),
      import('@spectrum-web-components/avatar/sp-avatar.js'),
      import('@spectrum-web-components/icons-workflow/icons/sp-icon-magnify.js'),
    ]);
  },
  render: () => html`
    <div style=${COL}>
      <p style=${CAP}>Plain, deletable, disabled, read only</p>
      <sp-tags>
        <sp-tag>Design</sp-tag>
        <sp-tag deletable>Engineering</sp-tag>
        <sp-tag disabled>Archived</sp-tag>
        <sp-tag readonly>Pinned</sp-tag>
      </sp-tags>

      <p style=${CAP}>With avatars</p>
      <sp-tags>
        <sp-tag deletable>
          Dana Okafor
          <sp-avatar slot="avatar" label="Dana Okafor" src=${sampleImage(64, 64, 20)}></sp-avatar>
        </sp-tag>
        <sp-tag deletable>
          Lee Chen
          <sp-avatar slot="avatar" label="Lee Chen" src=${sampleImage(64, 64, 140)}></sp-avatar>
        </sp-tag>
      </sp-tags>

      <p style=${CAP}>With icons</p>
      <sp-tags>
        <sp-tag>
          Search
          <sp-icon-magnify slot="icon" size="s"></sp-icon-magnify>
        </sp-tag>
        <sp-tag deletable>
          Filter
          <sp-icon-magnify slot="icon" size="s"></sp-icon-magnify>
        </sp-tag>
        <sp-tag disabled>
          Disabled
          <sp-icon-magnify slot="icon" size="s"></sp-icon-magnify>
        </sp-tag>
      </sp-tags>
    </div>
  `,
  notes:
    'Avatar and icon slots are detected through light-DOM presence queries; images are inline data: URIs.',
  interactive: false,
};
