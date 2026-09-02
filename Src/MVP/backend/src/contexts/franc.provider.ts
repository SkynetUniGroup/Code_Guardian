import { Provider } from '@nestjs/common';

export type FrancFn = (text: string) => string;

// franc-min is ESM-only; Jest can't do a real dynamic import() of an ESM
// package without --experimental-vm-modules, so that import can't live
// inside a plain function ContextsService calls directly (see
// readme-language.ts's history for why). Resolving it once here, at Nest's
// own module bootstrap — which runs under real Node, not Jest's sandbox —
// means the import only ever has to work in the one place that was always
// going to run outside Jest anyway. Everything downstream just receives an
// already-resolved, ordinary synchronous function via DI.
export const FRANC = Symbol('FRANC');

export const francProvider: Provider = {
  provide: FRANC,
  useFactory: async (): Promise<FrancFn> => {
    const { franc } = await import('franc-min');
    return franc;
  },
};
