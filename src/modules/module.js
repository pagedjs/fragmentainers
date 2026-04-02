export class Module {
  matches() {
    return false;
  }

  layout() {
    return { reservedBlockStart: 0, reservedBlockEnd: 0, afterRender: null };
  }

  beforeChildren() {
    return null;
  }
}
