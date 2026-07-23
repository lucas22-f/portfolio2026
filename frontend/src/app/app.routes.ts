import { ResolveFn, Routes } from '@angular/router';

import { loadPortfolioPresentation } from './core/content/portfolio-content';
import { ValidatedContentBundle } from './core/content/content-validator';
import { CONTENT_UNAVAILABLE_PATH } from './core/routing/navigation-error-handler';
import { ContentUnavailablePage } from './features/content-unavailable/content-unavailable-page';
import { ChatPage } from './features/chat/chat-page';
import { JourneyPage } from './features/journey/journey-page';
import { PortfolioPage } from './features/portfolio/portfolio-page';

const validatedPortfolioResolver: ResolveFn<ValidatedContentBundle> = () =>
  loadPortfolioPresentation();

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: JourneyPage },
  { path: 'chat', component: ChatPage },
  {
    path: 'perfil',
    component: PortfolioPage,
    resolve: { content: validatedPortfolioResolver },
    data: {
      kind: 'profile',
      title: 'Perfil profesional',
      eyebrow: 'Perfil',
    },
  },
  {
    path: 'experiencia',
    component: PortfolioPage,
    resolve: { content: validatedPortfolioResolver },
    data: {
      kind: 'experience',
      title: 'Experiencia',
      eyebrow: 'Trayectoria',
    },
  },
  {
    path: 'educacion',
    component: PortfolioPage,
    resolve: { content: validatedPortfolioResolver },
    data: {
      kind: 'education',
      title: 'Educación',
      eyebrow: 'Formación',
    },
  },
  {
    path: 'habilidades',
    component: PortfolioPage,
    resolve: { content: validatedPortfolioResolver },
    data: {
      kind: 'skill',
      title: 'Habilidades',
      eyebrow: 'Conocimientos',
    },
  },
  {
    path: 'proyectos',
    component: PortfolioPage,
    resolve: { content: validatedPortfolioResolver },
    data: {
      kind: 'project',
      title: 'Proyectos',
      eyebrow: 'Trabajo aplicado',
    },
  },
  {
    path: CONTENT_UNAVAILABLE_PATH,
    component: ContentUnavailablePage,
  },
  { path: '**', redirectTo: 'perfil' },
];
