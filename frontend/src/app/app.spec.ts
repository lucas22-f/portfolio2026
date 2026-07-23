import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should host the active route', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
  });

  it('keeps classic navigation available from the guided entry point', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('nav a'),
    );

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/perfil',
      '/experiencia',
      '/educacion',
      '/habilidades',
      '/proyectos',
      '/chat',
    ]);
  });
});
