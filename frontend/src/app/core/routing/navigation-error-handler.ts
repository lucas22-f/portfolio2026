import { inject } from '@angular/core';
import { NavigationError, RedirectCommand, Router } from '@angular/router';

export const CONTENT_UNAVAILABLE_PATH = 'contenido-no-disponible';

export function portfolioNavigationErrorHandler(
  error: NavigationError,
): RedirectCommand | undefined {
  if (error.url.split(/[?#]/u, 1)[0] === `/${CONTENT_UNAVAILABLE_PATH}`) {
    return undefined;
  }

  const router = inject(Router);
  return new RedirectCommand(router.parseUrl(`/${CONTENT_UNAVAILABLE_PATH}`), {
    replaceUrl: true,
  });
}
