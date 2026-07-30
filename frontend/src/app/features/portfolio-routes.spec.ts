import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../app.routes';

describe('portfolio routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes)],
    });
  });

  it('uses the root route for the guided entry point', async () => {
    const harness = await RouterTestingHarness.create('/');

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Un recorrido claro, sin atajos.',
    );
    expect(harness.routeNativeElement?.querySelector('#experience app-record-card')).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('#projects app-project-card')).not.toBeNull();
  });

  it('preserves reading order on entry and focuses subsequent fragment changes', async () => {
    const harness = await RouterTestingHarness.create('/#experience');
    await Promise.resolve();
    expect(document.activeElement).not.toBe(
      harness.routeNativeElement?.querySelector('#experience-title'),
    );

    await harness.navigateByUrl('/#projects');
    await Promise.resolve();
    expect(document.activeElement).toBe(harness.routeNativeElement?.querySelector('#projects-title'));
  });

  it.each([
    ['/perfil', 'intro'],
    ['/experiencia', 'experience'],
    ['/educacion', 'experience'],
    ['/habilidades', 'experience'],
    ['/proyectos', 'projects'],
  ])('redirects legacy %s only to the fixed #%s landing fragment', async (legacyPath, fragment) => {
    const harness = await RouterTestingHarness.create(legacyPath);
    const router = TestBed.inject(Router);

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Un recorrido claro, sin atajos.',
    );
    expect(router.url).toBe(`/#${fragment}`);
  });

  it('preserves a legacy query while replacing it with the fixed landing fragment', async () => {
    await RouterTestingHarness.create('/proyectos?source=legacy');
    const router = TestBed.inject(Router);

    expect(router.url).toBe('/?source=legacy#projects');
  });

  it('replaces a legacy fragment with its fixed destination fragment', async () => {
    await RouterTestingHarness.create('/proyectos#untrusted-fragment');
    const router = TestBed.inject(Router);

    expect(router.url).toBe('/#projects');
  });

  it('does not allow /chat to bypass the locked landing assistant', async () => {
    const harness = await RouterTestingHarness.create('/chat');
    const router = TestBed.inject(Router);

    expect(harness.routeNativeElement?.querySelector('app-chat-page')).toBeNull();
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Un recorrido claro, sin atajos.',
    );
    expect(router.url).toBe('/#assistant');
  });

  it('keeps a direct #assistant fragment on the landing without enabling chat', async () => {
    const harness = await RouterTestingHarness.create('/#assistant');

    expect(harness.routeNativeElement?.querySelector('app-chat-page')).toBeNull();
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Un recorrido claro, sin atajos.',
    );
  });

  it('redirects an unknown route to the intro fragment', async () => {
    await RouterTestingHarness.create('/does-not-exist');
    const router = TestBed.inject(Router);

    expect(router.url).toBe('/#intro');
  });
});
