# Spectrum SSR support matrix

- Run: 2026-10-14T15:17:19.155Z
- **0/0 components fully green**
- Per check: SSR markup 0/0, hydration 0/0, flicker 0/0, fidelity 0/0, interaction 0/0
- Thresholds: flicker < 0.200 % of pixels, CLS < 0.01, fidelity = post-hydration DOM equals the client-rendered DOM
- Legend: `ok` passed, `FAIL` failed, `-` not run / not applicable. Flicker % = differing pixels between the pure-SSR paint and the hydrated paint; the number in `ok (n)` is the count of hydrated sp-* elements.

| Component | SSR | Hydration | Flicker % | CLS | Fidelity | Interaction | Notes |
|---|---|---|---|---|---|---|---|
| _no results recorded_ | | | | | | | |

## Pages

- **1/1 pages green** (SSR markup + render report, hydration without errors / deferred elements / console errors, client-rendered reference page)

| Page | Routes | SSR | Hydration | CSR | Notes |
|---|---|---|---|---|---|
| all-components | `/`, `/csr` | ok | ok (1354) | ok (1354) |  |
