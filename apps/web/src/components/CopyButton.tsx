import { useEffect, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

const RESET_AFTER_MS = 1_500;

interface CopyButtonProps {
  value: string;
  label?: string;
}

export function CopyButton({ value, label = 'Copiar' }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => {
      setState('idle');
    }, RESET_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  async function copy() {
    try {
      // navigator.clipboard solo existe en contextos seguros (https o localhost).
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <button
      type="button"
      onClick={() => {
        void copy();
      }}
      className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
    >
      <span aria-live="polite">
        {state === 'copied' ? 'Copiado' : state === 'failed' ? 'No se pudo copiar' : label}
      </span>
    </button>
  );
}
