import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  viewChild,
} from '@angular/core';

@Component({
  selector: 'app-chat-page',
  template: `
    <main id="main-content" class="chat-page">
      <p class="chat-page__eyebrow">Consulta guiada</p>
      <h1 #heading data-testid="chat-heading" tabindex="-1">Chat informativo</h1>
      <p>Próximamente vas a poder consultar información respaldada por el contenido publicado.</p>
    </main>
  `,
  styleUrl: './chat-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPage implements AfterViewInit {
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');

  ngAfterViewInit(): void {
    this.heading().nativeElement.focus();
  }
}
