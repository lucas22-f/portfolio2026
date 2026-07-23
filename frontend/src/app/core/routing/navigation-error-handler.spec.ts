import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  NavigationError,
  provideRouter,
  Router,
  Routes,
  withNavigationErrorHandler,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ContentUnavailablePage } from '../../features/content-unavailable/content-unavailable-page';
import { portfolioNavigationErrorHandler } from './navigation-error-handler';

@Component({
  template: '<p>Contenido que no debe activarse</p>',
})
class BrokenPage {}

const testRoutes: Routes = [
  {
    path: 'contenido-roto',
    component: BrokenPage,
    resolve: {
      content: () => Promise.reject(new Error('detalle interno sensible')),
    },
  },
  {
    path: 'contenido-no-disponible',
    component: ContentUnavailablePage,
  },
];

describe('portfolio navigation error handling', () => {
  it('redirects rejected content validation to a usable Spanish error view', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(testRoutes, withNavigationErrorHandler(portfolioNavigationErrorHandler)),
      ],
    });
    const router = TestBed.inject(Router);
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/contenido-roto');

    expect(router.url).toBe('/contenido-no-disponible');
    expect(harness.routeNativeElement?.querySelector('main')).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Contenido no disponible',
    );
    expect(harness.routeNativeElement?.textContent).toContain(
      'No pude validar la información del portfolio.',
    );
    expect(harness.routeNativeElement?.textContent).not.toContain('detalle interno sensible');
  });

  it('does not redirect an error that already belongs to the unavailable route', () => {
    const error = new NavigationError(
      2,
      '/contenido-no-disponible?reintento=true',
      new Error('fallo local'),
    );

    expect(portfolioNavigationErrorHandler(error)).toBeUndefined();
  });
});
