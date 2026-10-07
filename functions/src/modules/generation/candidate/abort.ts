export class GenerationAbort extends Error {
  constructor(readonly kind: 'cancelled' | 'disconnected' | 'timeout') {
    super(kind);
    this.name = 'GenerationAbort';
  }
}
