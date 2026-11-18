import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate } from '../lib/router';

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
}

export function Link({ to, onClick, ...props }: LinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    // Ctrl/Cmd+clic y el botón central conservan el comportamiento del navegador.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  }

  return <a {...props} href={to} onClick={handleClick} />;
}
