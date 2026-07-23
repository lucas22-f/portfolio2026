import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../app.routes';

describe('portfolio routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes)],
    });
  });

  it.each([
    ['/perfil', 'Perfil profesional', 'Conversational AI Engineer y Backend Developer.'],
    ['/experiencia', 'Experiencia', 'MercadoLibre'],
    ['/educacion', 'Educación', 'Técnico Universitario en Programación'],
    ['/habilidades', 'Habilidades', 'IA y LLMs'],
    ['/proyectos', 'Proyectos', 'Sistemas RAG sobre Fury'],
  ])('renders %s as a semantic content view', async (path, heading, reviewedFact) => {
    const harness = await RouterTestingHarness.create(path);
    const view = harness.routeNativeElement as HTMLElement;

    expect(view.querySelector('main')).not.toBeNull();
    expect(view.querySelector('h1')?.textContent?.trim()).toBe(heading);
    expect(view.textContent).toContain(reviewedFact);
  });

  it('uses the root route for the guided entry point', async () => {
    const harness = await RouterTestingHarness.create('/');

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Un recorrido claro, sin atajos.',
    );
  });
});
