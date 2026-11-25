# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.0.7.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
npm run test:e2e
```

This project uses Playwright for end-to-end testing. Browser binaries will be installed later, when the end-to-end suite is implemented and needs to run.

## Microphone input in chat

Use **Grabar consulta**, allow microphone access, then **Detener y transcribir**.
Recording stops automatically after 30 seconds. **Cancelar audio** discards the
recording/transcription without changing the current draft. A secure context
(HTTPS or localhost), `getUserMedia`, and Web Audio `AudioContext` are required;
unsupported devices and denied permissions show Spanish guidance and keep keyboard
input available. Audio is encoded in memory as mono PCM16 WAV (16 kHz requested,
16–48 kHz accepted by the backend); microphone tracks, audio nodes/context, timers
and fetch are cleaned up on stop, cancel, failure or component destruction.

The visible disclosure explains that audio is sent to OpenAI and not stored by the
portfolio; no OpenAI retention policy is asserted. Transcription uses the protected
same-origin `/api/v1/chat/transcribe` function, not a browser OpenAI key. Plain
`ng serve` alone does not provide the Vercel function: use a same-origin API
integration environment. Do not configure the protected backend service token in
frontend environment files.

The transcript is appended to the existing draft and **never auto-sent**. Review
or edit it, then use **Enviar consulta** (or Enter; Shift+Enter keeps a newline).
If the draft changed during capture/transcription, its newer contents are preserved
and a notice asks you to record again. Errors preserve the draft. Transcripts over
500 characters remain editable and block sending until shortened by the user;
they are not silently truncated. Competing starter, send/retry and return controls
are blocked during the voice operation.

Deterministic mocked microphone/fetch tests live in `voice-input.spec.ts` and
`chat-page.spec.ts`. Run `npm run test:unit -- --watch=false` and `npm run build`
with dependencies installed for the host platform. These tests never use real
microphone permissions or paid provider requests.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
