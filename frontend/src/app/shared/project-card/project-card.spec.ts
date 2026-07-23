import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PortfolioRecord } from '../../core/content/content-validator';
import { ProjectCard } from './project-card';

const projectWithoutLinks: PortfolioRecord = {
  id: 'project-rag-fury',
  kind: 'project',
  title: 'Sistemas RAG sobre Fury',
  claims: [
    {
      claim_id: 'project-rag-fury-claim',
      text: 'Implementación de sistemas RAG sobre Fury.',
      provenance_id: 'cv-page-1',
    },
  ],
  tags: ['rag', 'fury'],
  aliases: ['Sistemas RAG sobre Fury'],
  project: { summary: 'Fuentes de conocimiento dinámicas y actualizadas.' },
  provenance: ['cv-page-1'],
};

describe('ProjectCard', () => {
  let fixture: ComponentFixture<ProjectCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectCard],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectCard);
  });

  it('renders reviewed project facts and omits links when none were approved', () => {
    fixture.componentRef.setInput('record', projectWithoutLinks);
    fixture.detectChanges();

    const card = fixture.nativeElement as HTMLElement;
    expect(card.querySelector('h2')?.textContent?.trim()).toBe('Sistemas RAG sobre Fury');
    expect(card.textContent).toContain('Fuentes de conocimiento dinámicas y actualizadas.');
    expect(card.querySelectorAll('a')).toHaveLength(0);
  });

  it('renders only explicitly supplied project links', () => {
    fixture.componentRef.setInput('record', {
      ...projectWithoutLinks,
      project: {
        ...projectWithoutLinks.project!,
        links: [{ label: 'Ver repositorio', url: 'https://github.com/lucas22-f/example' }],
      },
    });
    fixture.detectChanges();

    const links = fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>;
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent?.trim()).toBe('Ver repositorio');
    expect(links[0]?.href).toBe('https://github.com/lucas22-f/example');
  });
});
