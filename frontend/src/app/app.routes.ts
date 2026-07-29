import { inject } from '@angular/core';
import { RedirectFunction, ResolveFn, Router, Routes } from '@angular/router';

import { ValidatedContentBundle } from './core/content/content-validator';
import { loadPortfolioPresentation } from './core/content/portfolio-content';
import { CONTENT_UNAVAILABLE_PATH } from './core/routing/navigation-error-handler';
import { ContentUnavailablePage } from './features/content-unavailable/content-unavailable-page';
import { JourneyPage } from './features/journey/journey-page';

const validatedPortfolioResolver: ResolveFn<ValidatedContentBundle> = () =>
  loadPortfolioPresentation();

const redirectToFragment =
  (fragment: string): RedirectFunction =>
  (route) =>
    inject(Router).createUrlTree(['/'], { queryParams: route.queryParams, fragment });

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    component: JourneyPage,
    resolve: { content: validatedPortfolioResolver },
  },
  { path: 'perfil', pathMatch: 'full', redirectTo: redirectToFragment('intro') },
  { path: 'experiencia', pathMatch: 'full', redirectTo: redirectToFragment('experience') },
  { path: 'educacion', pathMatch: 'full', redirectTo: redirectToFragment('experience') },
  { path: 'habilidades', pathMatch: 'full', redirectTo: redirectToFragment('experience') },
  { path: 'proyectos', pathMatch: 'full', redirectTo: redirectToFragment('projects') },
  { path: 'chat', pathMatch: 'full', redirectTo: redirectToFragment('assistant') },
  {
    path: CONTENT_UNAVAILABLE_PATH,
    component: ContentUnavailablePage,
  },
  { path: '**', redirectTo: redirectToFragment('intro') },
];
